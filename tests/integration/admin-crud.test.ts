import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PATCH as patchPitchRoute, GET as getPitchRoute } from "@/app/api/admin/pitches/[id]/route";
import { POST as postPitchRoute } from "@/app/api/admin/venues/[id]/pitches/route";
import { GET as getVenueRoute, PATCH as patchVenueRoute } from "@/app/api/admin/venues/[id]/route";
import { POST as postVenueRoute } from "@/app/api/admin/venues/route";
import { GET as publicVenueRoute } from "@/app/api/venues/[venueSlug]/route";
import type { AdminPitchDto } from "@/features/pitches/admin-dto";
import type { AdminVenueDto } from "@/features/venues/admin-dto";
import type { ApiErrorBody } from "@/lib/api/errors";
import { generateToken, hashToken } from "@/lib/auth/token";
import { adminDb } from "@/lib/db/admin";
import { publicDb } from "@/lib/db/public";

import { LOCAL_ADMIN_URL } from "../setup/integration-env";

// Admin create/update endpoints against the local database (PR 2.10). Acceptance criteria: a
// revision row per mutation; a replayed Idempotency-Key returns the original result; a stale
// version → 409. Test records use the "crud-" slug prefix and are removed afterwards (their
// append-only revisions stay, as they would in production).

const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });
const run = randomUUID().slice(0, 8);
const slug = (name: string) => `crud-${run}-${name}`;

let token: string; // venues:write + pitches:write
let venuesOnly: string; // venues:write
let label: string;

async function mint(scopes: string[]): Promise<{ token: string; label: string }> {
  const t = generateToken();
  const l = `crud-${run}-${String(scopes.length)}-${randomUUID().slice(0, 6)}`;
  await operator`
    insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values (${l}, ${hashToken(t)}, ${scopes}, now() + interval '1 day')
  `;
  return { token: t, label: l };
}

type Headers = Record<string, string>;

function jsonRequest(method: string, path: string, body: unknown, headers: Headers = {}, auth = token): Request {
  return new Request(`https://ff.test${path}`, {
    method,
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

const createVenue = (body: unknown, headers?: Headers, auth?: string) =>
  postVenueRoute(jsonRequest("POST", "/api/admin/venues", body, headers, auth), params({}));
const readVenue = (id: string) =>
  getVenueRoute(
    new Request(`https://ff.test/api/admin/venues/${id}`, { headers: { authorization: `Bearer ${token}` } }),
    params({ id }),
  );
const patchVenue = (id: string, body: unknown, headers: Headers = {}) =>
  patchVenueRoute(jsonRequest("PATCH", `/api/admin/venues/${id}`, body, headers), params({ id }));
const createPitch = (venueId: string, body: unknown, headers?: Headers, auth?: string) =>
  postPitchRoute(
    jsonRequest("POST", `/api/admin/venues/${venueId}/pitches`, body, headers, auth),
    params({ id: venueId }),
  );
const readPitch = (id: string) =>
  getPitchRoute(
    new Request(`https://ff.test/api/admin/pitches/${id}`, { headers: { authorization: `Bearer ${token}` } }),
    params({ id }),
  );
const patchPitch = (id: string, body: unknown, headers: Headers = {}) =>
  patchPitchRoute(jsonRequest("PATCH", `/api/admin/pitches/${id}`, body, headers), params({ id }));

async function ok<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return JSON.parse(text) as T;
}

async function fails(res: Response, status: number, code: string): Promise<ApiErrorBody> {
  const body = (await res.json()) as ApiErrorBody;
  expect(res.status, JSON.stringify(body)).toBe(status);
  expect(body.code).toBe(code);
  return body;
}

interface Revision {
  entity_type: string;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  actor_label: string;
  request_id: string | null;
}

const revisions = (entityId: string) => operator<Revision[]>`
  select entity_type::text, action::text, changes, actor_label, request_id
  from public.field_revisions where entity_id = ${entityId}::uuid order by id
`;

const VENUE = (name: string) => ({
  slug: slug(name),
  name: `Crud ${name}`,
  suburb: "Testville",
  state: "NT",
  latitude: -12.46,
  longitude: 130.84,
});

beforeAll(async () => {
  ({ token, label } = await mint(["venues:write", "pitches:write"]));
  ({ token: venuesOnly } = await mint(["venues:write"]));
});

afterAll(async () => {
  await operator`delete from public.pitches where venue_id in (select id from public.venues where slug like ${`crud-${run}-%`})`;
  await operator`delete from public.venues where slug like ${`crud-${run}-%`}`;
  await operator.end({ timeout: 5 });
  await adminDb().end({ timeout: 5 });
  await publicDb().end({ timeout: 5 });
});

describe("POST /api/admin/venues", () => {
  it("creates a draft with a revision per change, an ETag and a Location", async () => {
    const res = await createVenue({ ...VENUE("create"), postcode: "0800", amenities: { parking: "yes", cafe: "no" } });
    const { venue } = await ok<{ venue: AdminVenueDto }>(res, 201);

    expect(venue).toMatchObject({ slug: slug("create"), status: "draft", postcode: "0800", access: null });
    expect(venue.amenities).toMatchObject({ parking: "yes", cafe: "no", toilets: "unknown" });
    expect(res.headers.get("etag")).toBe(`"${venue.version}"`);
    expect(res.headers.get("location")).toBe(`/api/admin/venues/${venue.id}`);

    const rows = await revisions(venue.id);
    expect(rows.map((r) => `${r.entity_type}:${r.action}`)).toEqual([
      "venue:create",
      "venue_amenity:create",
      "venue_amenity:create",
    ]);
    expect(rows[0]?.changes).toMatchObject({
      slug: { from: null, to: slug("create") },
      name: { from: null, to: "Crud create" },
      status: { from: null, to: "draft" },
    });
    for (const row of rows) {
      expect(row.actor_label).toBe(label);
      expect(row.request_id).toBe(res.headers.get("x-request-id"));
    }
  });

  it("keeps a new draft out of every public route", async () => {
    await ok(await createVenue(VENUE("hidden")), 201);
    const res = await publicVenueRoute(new Request("https://ff.test/"), params({ venueSlug: slug("hidden") }));
    expect(res.status).toBe(404);
  });

  it("rejects a duplicate slug with 409, and invalid input with 400", async () => {
    await ok(await createVenue(VENUE("dupe")), 201);
    await fails(await createVenue(VENUE("dupe")), 409, "conflict");
    await fails(await createVenue({ ...VENUE("bad"), status: "published" }), 400, "invalid_request");
    await fails(await createVenue({ ...VENUE("bad"), latitude: 95 }), 400, "invalid_request");
    await fails(await createVenue("{not json"), 400, "invalid_request");
  });
});

describe("Idempotency-Key", () => {
  it("replays the original result for a retry, without creating anything twice", async () => {
    const headers = { "idempotency-key": `crud-${run}-replay-1` };
    const first = await createVenue(VENUE("replay"), headers);
    const firstBody = await ok<{ venue: AdminVenueDto }>(first, 201);
    const before = await revisions(firstBody.venue.id);

    const second = await createVenue(VENUE("replay"), headers);
    expect(await ok(second, 201)).toEqual(firstBody);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
    expect(second.headers.get("location")).toBe(first.headers.get("location"));

    const [count] = await operator<
      { n: number }[]
    >`select count(*)::int as n from public.venues where slug = ${slug("replay")}`;
    expect(count?.n).toBe(1);
    expect(await revisions(firstBody.venue.id)).toHaveLength(before.length);
  });

  it("gives concurrent duplicates the same single result", async () => {
    const headers = { "idempotency-key": `crud-${run}-race-1` };
    const [a, b] = await Promise.all([createVenue(VENUE("race"), headers), createVenue(VENUE("race"), headers)]);
    const bodies = await Promise.all([ok<{ venue: AdminVenueDto }>(a, 201), ok<{ venue: AdminVenueDto }>(b, 201)]);
    expect(bodies[0]).toEqual(bodies[1]);
    expect([a, b].filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
  });

  it("rejects the same key with a different request (422) and creates nothing", async () => {
    const headers = { "idempotency-key": `crud-${run}-mismatch-1` };
    await ok(await createVenue(VENUE("mismatch-a"), headers), 201);
    await fails(await createVenue(VENUE("mismatch-b"), headers), 422, "idempotency_mismatch");
    const [count] = await operator<
      { n: number }[]
    >`select count(*)::int as n from public.venues where slug = ${slug("mismatch-b")}`;
    expect(count?.n).toBe(0);
  });

  it("doesn't store failures, so a failed request can be retried with the same key", async () => {
    await ok(await createVenue(VENUE("taken")), 201);
    const headers = { "idempotency-key": `crud-${run}-retry-1` };
    await fails(await createVenue(VENUE("taken"), headers), 409, "conflict");
    // The same key is still free for the same request: it fails the same way, not 422.
    await fails(await createVenue(VENUE("taken"), headers), 409, "conflict");
  });

  it("is scoped to the credential", async () => {
    const headers = { "idempotency-key": `crud-${run}-scope-1` };
    await ok(await createVenue(VENUE("scope-a"), headers), 201);
    // Another credential using the same key is a separate request.
    const other = await createVenue(VENUE("scope-b"), headers, venuesOnly);
    expect((await ok<{ venue: AdminVenueDto }>(other, 201)).venue.slug).toBe(slug("scope-b"));
  });
});

describe("PATCH /api/admin/venues/[id]", () => {
  async function fresh(name: string): Promise<{ venue: AdminVenueDto; etag: string }> {
    const res = await createVenue(VENUE(name));
    const { venue } = await ok<{ venue: AdminVenueDto }>(res, 201);
    return { venue, etag: String(res.headers.get("etag")) };
  }

  it("updates with the current version, records the diff and returns a new ETag", async () => {
    const { venue, etag } = await fresh("patch");
    const read = await readVenue(venue.id);
    expect(read.headers.get("etag")).toBe(etag);

    const res = await patchVenue(
      venue.id,
      { name: "Renamed", description: "Synthetic test venue." },
      { "if-match": etag },
    );
    const { venue: updated } = await ok<{ venue: AdminVenueDto }>(res, 200);
    expect(updated).toMatchObject({ name: "Renamed", description: "Synthetic test venue." });
    expect(res.headers.get("etag")).not.toBe(etag);

    const last = (await revisions(venue.id)).at(-1);
    expect(last).toMatchObject({ entity_type: "venue", action: "update", request_id: res.headers.get("x-request-id") });
    expect(last?.changes).toEqual({
      name: { from: "Crud patch", to: "Renamed" },
      description: { from: null, to: "Synthetic test venue." },
    });
  });

  it("rejects a stale version with 409 and a missing one with 400", async () => {
    const { venue, etag } = await fresh("stale");
    await ok(await patchVenue(venue.id, { name: "First" }, { "if-match": etag }));
    const before = await revisions(venue.id);

    await fails(await patchVenue(venue.id, { name: "Second" }, { "if-match": etag }), 409, "conflict");
    await fails(await patchVenue(venue.id, { name: "Second" }), 400, "invalid_request");
    expect(await revisions(venue.id)).toHaveLength(before.length);
  });

  it("replays a successful PATCH retried with its key instead of reporting a conflict", async () => {
    const { venue, etag } = await fresh("patch-replay");
    const headers = { "if-match": etag, "idempotency-key": `crud-${run}-patch-1` };
    const first = await ok(await patchVenue(venue.id, { name: "Once" }, headers));
    const retry = await patchVenue(venue.id, { name: "Once" }, headers);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(await ok(retry)).toEqual(first);
  });

  it("moves the version on an amenity-only change, with one revision per amenity", async () => {
    const { venue, etag } = await fresh("amenities");
    const res = await patchVenue(venue.id, { amenities: { toilets: "yes", parking: "no" } }, { "if-match": etag });
    const { venue: updated } = await ok<{ venue: AdminVenueDto }>(res);
    expect(updated.amenities).toMatchObject({ toilets: "yes", parking: "no" });
    expect(res.headers.get("etag")).not.toBe(etag);

    const amenityRows = (await revisions(venue.id)).filter((r) => r.entity_type === "venue_amenity");
    expect(amenityRows.map((r) => r.changes)).toEqual([
      { toilets: { from: "unknown", to: "yes" } },
      { parking: { from: "unknown", to: "no" } },
    ]);
  });

  it("treats a patch that changes nothing as a no-op: same version, no revision", async () => {
    const { venue, etag } = await fresh("noop");
    const before = await revisions(venue.id);
    const res = await patchVenue(venue.id, { name: "Crud noop", amenities: { cafe: "unknown" } }, { "if-match": etag });
    await ok(res);
    expect(res.headers.get("etag")).toBe(etag);
    expect(await revisions(venue.id)).toHaveLength(before.length);
  });

  it("rolls back everything when part of the change fails", async () => {
    await fresh("rollback-taken");
    const { venue, etag } = await fresh("rollback");
    const before = await revisions(venue.id);
    const res = await patchVenue(
      venue.id,
      { slug: slug("rollback-taken"), amenities: { toilets: "yes" } },
      { "if-match": etag },
    );
    await fails(res, 409, "conflict");
    const after = await ok<{ venue: AdminVenueDto }>(await readVenue(venue.id));
    expect(after.venue.amenities.toilets).toBe("unknown");
    expect(await revisions(venue.id)).toHaveLength(before.length);
  });

  it("allows a slug change only while the venue has never been published", async () => {
    const { venue, etag } = await fresh("slug");
    const renamed = await patchVenue(venue.id, { slug: slug("slug-2") }, { "if-match": etag });
    const next = String(renamed.headers.get("etag"));
    await ok(renamed);

    await operator`update public.venues set status = 'published' where id = ${venue.id}::uuid`;
    const current = String((await readVenue(venue.id)).headers.get("etag"));
    expect(current).not.toBe(next);
    await fails(await patchVenue(venue.id, { slug: slug("slug-3") }, { "if-match": current }), 409, "conflict");
    // Other fields of a published venue can still be corrected.
    await ok(await patchVenue(venue.id, { name: "Corrected" }, { "if-match": current }));
  });

  it("refuses to edit an archived venue or add pitches to it", async () => {
    const { venue } = await fresh("archived");
    await operator`update public.venues set status = 'archived' where id = ${venue.id}::uuid`;
    const etag = String((await readVenue(venue.id)).headers.get("etag"));
    await fails(await patchVenue(venue.id, { name: "Nope" }, { "if-match": etag }), 409, "conflict");
    await fails(await createPitch(venue.id, { slug: "pitch-1", name: "Pitch 1" }), 409, "conflict");
  });

  it("404s an unknown venue and 400s a malformed id", async () => {
    const missing = randomUUID();
    await fails(await readVenue(missing), 404, "not_found");
    await fails(await patchVenue(missing, { name: "x" }, { "if-match": '"1"' }), 404, "not_found");
    await fails(await readVenue("not-a-uuid"), 400, "invalid_request");
  });
});

describe("pitches", () => {
  let venueId: string;

  beforeAll(async () => {
    const { venue } = await ok<{ venue: AdminVenueDto }>(await createVenue(VENUE("pitches")), 201);
    venueId = venue.id;
  });

  it("creates a draft pitch with a revision, and needs the pitches:write scope", async () => {
    await fails(await createPitch(venueId, { slug: "pitch-1", name: "Pitch 1" }, {}, venuesOnly), 403, "forbidden");

    const res = await createPitch(venueId, { slug: "pitch-1", name: "Pitch 1", surface: "grass", lengthMeters: 105.5 });
    const { pitch } = await ok<{ pitch: AdminPitchDto }>(res, 201);
    expect(pitch).toMatchObject({ venueId, status: "draft", surface: "grass", lengthMeters: 105.5, widthMeters: null });
    expect(res.headers.get("location")).toBe(`/api/admin/pitches/${pitch.id}`);
    const rows = await revisions(pitch.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: "pitch", action: "create" });
    expect(rows[0]?.changes).toMatchObject({
      venue_id: { from: null, to: venueId },
      length_m: { from: null, to: 105.5 },
    });
  });

  it("rejects a duplicate slug within the venue, dimensions it would round, and an unknown venue", async () => {
    await ok(await createPitch(venueId, { slug: "pitch-2", name: "Pitch 2" }), 201);
    await fails(await createPitch(venueId, { slug: "pitch-2", name: "Again" }), 409, "conflict");
    await fails(await createPitch(venueId, { slug: "pitch-3", name: "P", widthMeters: 68.25 }), 400, "invalid_request");
    await fails(await createPitch(randomUUID(), { slug: "pitch-1", name: "P" }), 404, "not_found");
  });

  it("updates with If-Match, clears to null, and rejects a stale version", async () => {
    const created = await createPitch(venueId, { slug: "pitch-4", name: "Pitch 4", floodlights: true });
    const { pitch } = await ok<{ pitch: AdminPitchDto }>(created, 201);
    const etag = String((await readPitch(pitch.id)).headers.get("etag"));
    expect(etag).toBe(created.headers.get("etag"));

    const res = await patchPitch(pitch.id, { floodlights: null, access: "members_only" }, { "if-match": etag });
    const { pitch: updated } = await ok<{ pitch: AdminPitchDto }>(res);
    expect(updated).toMatchObject({ floodlights: null, access: "members_only" });
    expect((await revisions(pitch.id)).at(-1)?.changes).toEqual({
      floodlights: { from: true, to: null },
      access: { from: null, to: "members_only" },
    });

    await fails(await patchPitch(pitch.id, { name: "Stale" }, { "if-match": etag }), 409, "conflict");
  });
});
