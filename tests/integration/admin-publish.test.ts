import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as archivePitchRoute } from "@/app/api/admin/pitches/[id]/archive/route";
import { POST as publishPitchRoute } from "@/app/api/admin/pitches/[id]/publish/route";
import { PATCH as patchPitchRoute } from "@/app/api/admin/pitches/[id]/route";
import { POST as unpublishPitchRoute } from "@/app/api/admin/pitches/[id]/unpublish/route";
import { POST as archiveVenueRoute } from "@/app/api/admin/venues/[id]/archive/route";
import { POST as createPitchRoute } from "@/app/api/admin/venues/[id]/pitches/route";
import { POST as publishVenueRoute } from "@/app/api/admin/venues/[id]/publish/route";
import { PATCH as patchVenueRoute } from "@/app/api/admin/venues/[id]/route";
import { POST as unpublishVenueRoute } from "@/app/api/admin/venues/[id]/unpublish/route";
import { POST as verifyRoute } from "@/app/api/admin/venues/[id]/verifications/route";
import { POST as createVenueRoute } from "@/app/api/admin/venues/route";
import { GET as searchRoute } from "@/app/api/venues/route";
import { GET as publicVenueRoute } from "@/app/api/venues/[venueSlug]/route";
import type { AdminPitchDto } from "@/features/pitches/admin-dto";
import type { VenueSearchResponse } from "@/features/search/search";
import type { AdminVenueDto } from "@/features/venues/admin-dto";
import type { VenueDetailResponse } from "@/features/venues/detail";
import type { ApiErrorBody } from "@/lib/api/errors";
import { generateToken, hashToken } from "@/lib/auth/token";
import { adminDb } from "@/lib/db/admin";
import { publicDb } from "@/lib/db/public";

import { LOCAL_ADMIN_URL } from "../setup/integration-env";

// Publish, unpublish and archive against the local database (PR 2.11). Acceptance: a venue is absent
// from search until published and present after; archiving removes it; audit rows are written.
// Test venues are in Alice Springs so search there sees only them; they're removed afterwards.

const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });
const run = randomUUID().slice(0, 8);
const slug = (name: string) => `pub-${run}-${name}`;
const SECRET_NOTE = `internal-${run}-never-public`;

// Canonical form (10 km is the default radius, so it is omitted; other spellings get a 308).
const SEARCH = "lat=-23.698&lng=133.881";

let token: string; // venues:write, pitches:write, content:publish
let label: string;
let editorOnly: string; // venues:write, pitches:write

async function mint(scopes: string[]): Promise<{ token: string; label: string }> {
  const t = generateToken();
  const l = `pub-${run}-${randomUUID().slice(0, 6)}`;
  await operator`
    insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values (${l}, ${hashToken(t)}, ${scopes}, now() + interval '1 day')
  `;
  return { token: t, label: l };
}

type Headers = Record<string, string>;
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

function req(method: string, path: string, body?: unknown, headers: Headers = {}, auth = token): Request {
  return new Request(`https://ff.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${auth}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function ok<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}

async function fails(res: Response, status: number, code: string): Promise<void> {
  const body = (await res.json()) as ApiErrorBody;
  expect(res.status, JSON.stringify(body)).toBe(status);
  expect(body.code).toBe(code);
}

interface VenueResult {
  venue: AdminVenueDto;
  pitches: AdminPitchDto[];
}

/** A draft venue in Alice Springs with `pitchCount` draft pitches. */
async function draftVenue(name: string, pitchCount = 2): Promise<{ id: string; etag: string; pitchIds: string[] }> {
  const res = await createVenueRoute(
    req("POST", "/api/admin/venues", {
      slug: slug(name),
      name: `Pub ${name}`,
      suburb: "Alice Springs",
      state: "NT",
      latitude: -23.7,
      longitude: 133.88,
    }),
    params({}),
  );
  const { venue } = await ok<{ venue: AdminVenueDto }>(res, 201);
  const pitchIds: string[] = [];
  for (let i = 1; i <= pitchCount; i++) {
    const p = await createPitchRoute(
      req("POST", `/api/admin/venues/${venue.id}/pitches`, { slug: `pitch-${String(i)}`, name: `Pitch ${String(i)}` }),
      params({ id: venue.id }),
    );
    pitchIds.push((await ok<{ pitch: AdminPitchDto }>(p, 201)).pitch.id);
  }
  return { id: venue.id, etag: `"${venue.version}"`, pitchIds };
}

const verify = (
  venueId: string,
  body: unknown = { verifiedBy: "Test operator", verifiedOn: "2026-11-01", confidence: "high" },
) => verifyRoute(req("POST", `/api/admin/venues/${venueId}/verifications`, body), params({ id: venueId }));

const publishVenue = (id: string, etag: string, body: unknown, headers: Headers = {}, auth?: string) =>
  publishVenueRoute(
    req("POST", `/api/admin/venues/${id}/publish`, body, { "if-match": etag, ...headers }, auth),
    params({ id }),
  );
const unpublishVenue = (id: string, etag: string) =>
  unpublishVenueRoute(
    req("POST", `/api/admin/venues/${id}/unpublish`, undefined, { "if-match": etag }),
    params({ id }),
  );
const archiveVenue = (id: string, etag: string, body?: unknown) =>
  archiveVenueRoute(req("POST", `/api/admin/venues/${id}/archive`, body, { "if-match": etag }), params({ id }));
const publishPitch = (id: string, etag: string) =>
  publishPitchRoute(req("POST", `/api/admin/pitches/${id}/publish`, undefined, { "if-match": etag }), params({ id }));
const unpublishPitch = (id: string, etag: string) =>
  unpublishPitchRoute(
    req("POST", `/api/admin/pitches/${id}/unpublish`, undefined, { "if-match": etag }),
    params({ id }),
  );
const archivePitch = (id: string, etag: string) =>
  archivePitchRoute(req("POST", `/api/admin/pitches/${id}/archive`, undefined, { "if-match": etag }), params({ id }));

async function searchSlugs(): Promise<Map<string, VenueSearchResponse["items"][number]>> {
  const res = await searchRoute(new Request(`https://ff.test/api/venues?${SEARCH}`), params({}));
  const body = await ok<VenueSearchResponse>(res);
  return new Map(body.items.map((item) => [item.slug, item]));
}

const publicDetail = (venueSlug: string) => publicVenueRoute(new Request("https://ff.test/"), params({ venueSlug }));

const pitchEtag = async (id: string) => {
  const [row] = await operator<{ v: string }[]>`
    select (extract(epoch from updated_at) * 1000000)::bigint::text as v from public.pitches where id = ${id}::uuid
  `;
  return `"${String(row?.v)}"`;
};

/** The publish body for `ids`, with each pitch's current version (what a publisher would have read). */
async function selection(ids: string[]): Promise<{ pitches: { id: string; version: string }[] }> {
  const rows = await operator<{ id: string; v: string }[]>`
    select id::text, (extract(epoch from updated_at) * 1000000)::bigint::text as v
    from public.pitches where id = any(${ids}::uuid[])
  `;
  const versions = new Map(rows.map((r) => [r.id, r.v]));
  return { pitches: ids.map((id) => ({ id, version: versions.get(id) ?? "0" })) };
}

interface Publication {
  entity_type: string;
  entity_id: string;
  from_status: string;
  to_status: string;
  actor_label: string;
  reason: string | null;
  request_id: string | null;
}

const publications = (ids: string[]) => operator<Publication[]>`
  select entity_type::text, entity_id::text, from_status::text, to_status::text, actor_label, reason, request_id
  from public.field_publications where entity_id = any(${ids}::uuid[]) order by id
`;

beforeAll(async () => {
  ({ token, label } = await mint(["venues:write", "pitches:write", "content:publish"]));
  ({ token: editorOnly } = await mint(["venues:write", "pitches:write"]));
});

afterAll(async () => {
  const venues = operator`select id from public.venues where slug like ${`pub-${run}-%`}`;
  await operator`delete from public.field_verifications where venue_id in (${venues})`;
  await operator`delete from public.pitches where venue_id in (${venues})`;
  await operator`delete from public.venues where slug like ${`pub-${run}-%`}`;
  await operator.end({ timeout: 5 });
  await adminDb().end({ timeout: 5 });
  await publicDb().end({ timeout: 5 });
});

describe("venue lifecycle (acceptance)", () => {
  it("is absent from search until published, present after, and gone again once archived, with audit rows", async () => {
    const { id, etag, pitchIds } = await draftVenue("lifecycle");
    const [p1, p2] = pitchIds as [string, string];
    expect((await searchSlugs()).has(slug("lifecycle"))).toBe(false);
    expect((await publicDetail(slug("lifecycle"))).status).toBe(404);

    await ok(await verify(id), 201);
    const published = await publishVenue(id, etag, { ...(await selection([p1])), reason: "Site visit done" });
    const after = await ok<VenueResult>(published);
    expect(after.venue.status).toBe("published");
    expect(Object.fromEntries(after.pitches.map((p) => [p.id, p.status]))).toEqual({
      [p1]: "published",
      [p2]: "draft",
    });

    const hit = (await searchSlugs()).get(slug("lifecycle"));
    expect(hit).toMatchObject({ publishedPitchCount: 1, href: `/venues/${slug("lifecycle")}/pitches/pitch-1` });
    const detail = await ok<VenueDetailResponse>(await publicDetail(slug("lifecycle")));
    expect(detail.pitches.map((p) => p.slug)).toEqual(["pitch-1"]);

    const requestId = published.headers.get("x-request-id");
    expect(await publications([id, p1, p2])).toEqual([
      {
        entity_type: "venue",
        entity_id: id,
        from_status: "draft",
        to_status: "published",
        actor_label: label,
        reason: "Site visit done",
        request_id: requestId,
      },
      {
        entity_type: "pitch",
        entity_id: p1,
        from_status: "draft",
        to_status: "published",
        actor_label: label,
        reason: "Site visit done",
        request_id: requestId,
      },
    ]);

    const archived = await ok<VenueResult>(
      await archiveVenue(id, String(published.headers.get("etag")), { reason: "Closed" }),
    );
    expect(archived.venue.status).toBe("archived");
    expect(archived.pitches.map((p) => p.status)).toEqual(["archived", "archived"]);
    expect((await searchSlugs()).has(slug("lifecycle"))).toBe(false);
    expect((await publicDetail(slug("lifecycle"))).status).toBe(404);

    const rows = await publications([id, p1, p2]);
    expect(
      rows
        .slice(2)
        .map((r) => `${r.entity_type}:${r.from_status}→${r.to_status}`)
        .sort(),
    ).toEqual(["pitch:draft→archived", "pitch:published→archived", "venue:published→archived"]);

    // Archiving is final through the API.
    const archivedEtag = `"${archived.venue.version}"`;
    await fails(await publishVenue(id, archivedEtag, await selection([p1])), 409, "conflict");
    await fails(await unpublishVenue(id, archivedEtag), 409, "conflict");
    await fails(
      await patchVenueRoute(
        req("PATCH", `/api/admin/venues/${id}`, { name: "x" }, { "if-match": archivedEtag }),
        params({ id }),
      ),
      409,
      "conflict",
    );
  });
});

describe("POST /api/admin/venues/[id]/publish", () => {
  it("requires a verification first, and changes nothing without one", async () => {
    const { id, etag, pitchIds } = await draftVenue("unverified", 1);
    await fails(await publishVenue(id, etag, await selection(pitchIds)), 409, "conflict");
    expect(await publications([id, ...pitchIds])).toEqual([]);
    expect((await searchSlugs()).has(slug("unverified"))).toBe(false);
  });

  it("validates the selection, the version and the scope", async () => {
    const { id, etag, pitchIds } = await draftVenue("validate", 1);
    const other = await draftVenue("validate-other", 1);
    await ok(await verify(id), 201);

    await fails(await publishVenue(id, etag, { pitches: [] }), 400, "invalid_request");
    await fails(await publishVenue(id, etag, {}), 400, "invalid_request");
    await fails(
      await publishVenue(id, etag, await selection([String(pitchIds[0]), String(pitchIds[0])])),
      400,
      "invalid_request",
    );
    await fails(await publishVenue(id, etag, await selection(other.pitchIds)), 400, "invalid_request");
    await fails(await publishVenue(id, '"1"', await selection(pitchIds)), 409, "conflict");
    await fails(
      await publishVenueRoute(
        req("POST", `/api/admin/venues/${id}/publish`, await selection(pitchIds)),
        params({ id }),
      ),
      400,
      "invalid_request",
    );
    await fails(await publishVenue(id, etag, await selection(pitchIds), {}, editorOnly), 403, "forbidden");
    expect(await publications([id])).toEqual([]);
  });

  it("409s when a selected pitch changed after it was reviewed", async () => {
    const { id, etag, pitchIds } = await draftVenue("stale-pitch", 1);
    await ok(await verify(id), 201);
    const reviewed = await selection(pitchIds);
    const [pitchId] = pitchIds as [string];
    // Someone edits the pitch after the publisher read it. The venue's own version doesn't move.
    const edit = await patchPitchRoute(
      req("PATCH", `/api/admin/pitches/${pitchId}`, { surface: "synthetic" }, { "if-match": await pitchEtag(pitchId) }),
      params({ id: pitchId }),
    );
    await ok(edit);
    await fails(await publishVenue(id, etag, reviewed), 409, "conflict");
    expect(await publications([id, pitchId])).toEqual([]);
    // Re-reading the pitch and publishing what was actually reviewed works.
    await ok(await publishVenue(id, etag, await selection(pitchIds)));
  });

  it("409s when there's nothing left to publish, and replays a retried publish", async () => {
    const { id, etag, pitchIds } = await draftVenue("replay", 1);
    await ok(await verify(id), 201);
    const headers = { "idempotency-key": `pub-${run}-replay` };
    const body = await selection(pitchIds); // the same request both times
    const first = await publishVenue(id, etag, body, headers);
    const firstBody = await ok<VenueResult>(first);
    const retry = await publishVenue(id, etag, body, headers);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(await ok<VenueResult>(retry)).toEqual(firstBody);
    expect(await publications([id, ...pitchIds])).toHaveLength(2);

    await fails(await publishVenue(id, String(first.headers.get("etag")), await selection(pitchIds)), 409, "conflict");
  });

  it("locks the slug once published, even after unpublishing", async () => {
    const { id, etag, pitchIds } = await draftVenue("unpublish", 1);
    await ok(await verify(id), 201);
    const published = await publishVenue(id, etag, await selection(pitchIds));
    await ok(published);

    const unpublished = await unpublishVenue(id, String(published.headers.get("etag")));
    expect((await ok<VenueResult>(unpublished)).venue.status).toBe("draft");
    expect((await searchSlugs()).has(slug("unpublish"))).toBe(false);
    await fails(await unpublishVenue(id, String(unpublished.headers.get("etag"))), 409, "conflict");

    const patch = await patchVenueRoute(
      req(
        "PATCH",
        `/api/admin/venues/${id}`,
        { slug: slug("unpublish-renamed") },
        { "if-match": String(unpublished.headers.get("etag")) },
      ),
      params({ id }),
    );
    await fails(patch, 409, "conflict");
  });
});

describe("pitch transitions", () => {
  it("publishes a pitch only once its venue is published; unpublishing the last pitch hides the venue", async () => {
    const { id, etag, pitchIds } = await draftVenue("pitches");
    const [p1, p2] = pitchIds as [string, string];
    await fails(await publishPitch(p2, await pitchEtag(p2)), 409, "conflict");

    await ok(await verify(id), 201);
    await ok(await publishVenue(id, etag, await selection([p1])));
    const res = await publishPitch(p2, await pitchEtag(p2));
    expect((await ok<{ pitch: AdminPitchDto }>(res)).pitch.status).toBe("published");
    expect(res.headers.get("etag")).toBe(await pitchEtag(p2));
    expect((await searchSlugs()).get(slug("pitches"))?.publishedPitchCount).toBe(2);
    await fails(await publishPitch(p2, await pitchEtag(p2)), 409, "conflict");

    await ok(await unpublishPitch(p1, await pitchEtag(p1)));
    await ok(await archivePitch(p2, await pitchEtag(p2)));
    // No published pitch left: the venue drops out of search and its page 404s.
    expect((await searchSlugs()).has(slug("pitches"))).toBe(false);
    expect((await publicDetail(slug("pitches"))).status).toBe(404);
    await fails(await publishPitch(p2, await pitchEtag(p2)), 409, "conflict"); // archived is final

    expect((await publications([p1, p2])).map((r) => `${r.from_status}→${r.to_status}`)).toEqual([
      "draft→published",
      "draft→published",
      "published→draft",
      "published→archived",
    ]);
  });
});

describe("concurrent transitions", () => {
  it("a pitch publish racing its venue's archive never deadlocks (Codex review)", async () => {
    // Before the fix, the pitch publish locked pitch → venue and the archive venue → pitch, so the two
    // could deadlock and one came back as a 500. Both now lock venue first.
    // ~90 requests: give them their own credential so the per-credential limit (120/min) doesn't
    // spill into the other tests in this file.
    const shared = token;
    ({ token } = await mint(["venues:write", "pitches:write", "content:publish"]));
    const statuses: number[] = [];
    try {
      for (let i = 0; i < 8; i++) {
        const { id, etag, pitchIds } = await draftVenue(`race-${String(i)}`);
        const [p1, p2] = pitchIds as [string, string];
        await ok(await verify(id), 201);
        const published = await publishVenue(id, etag, await selection([p1]));
        const venueEtag = String(published.headers.get("etag"));
        const p2Etag = await pitchEtag(p2);
        const [a, b] = await Promise.all([publishPitch(p2, p2Etag), archiveVenue(id, venueEtag)]);
        statuses.push(a.status, b.status);
      }
    } finally {
      token = shared;
    }
    expect(statuses.filter((status) => status !== 200 && status !== 409)).toEqual([]);
    // ~90 sequential requests: allow for a slow runner instead of timing out mid-loop, which would
    // let a venue be created after the file's cleanup has already run.
  }, 30_000);
});

describe("POST /api/admin/venues/[id]/verifications", () => {
  it("records a verification that never appears on a public route", async () => {
    const { id, etag, pitchIds } = await draftVenue("verify", 1);
    const res = await verify(id, {
      verifiedBy: "Test operator",
      verifiedOn: "2026-10-30",
      confidence: "medium",
      evidence: "Photos of the goals and the council map",
      internalNotes: SECRET_NOTE,
    });
    const { verification } = await ok<{ verification: Record<string, unknown> }>(res, 201);
    expect(verification).toMatchObject({
      venueId: id,
      verifiedOn: "2026-10-30",
      confidence: "medium",
      internalNotes: SECRET_NOTE,
    });

    const [revision] = await operator<{ changes: Record<string, unknown> }[]>`
      select changes from public.field_revisions where entity_type = 'field_verification' and entity_id = ${String(verification.id)}::uuid
    `;
    // Who, when and how sure; never the evidence or internal notes. (No source, so no source_id change.)
    expect(Object.keys(revision?.changes ?? {}).sort()).toEqual([
      "confidence",
      "venue_id",
      "verified_by",
      "verified_on",
    ]);

    await ok(await publishVenue(id, etag, await selection(pitchIds)));
    const publicText = await (await publicDetail(slug("verify"))).text();
    const searchText = await (
      await searchRoute(new Request(`https://ff.test/api/venues?${SEARCH}`), params({}))
    ).text();
    for (const text of [publicText, searchText]) {
      expect(text).not.toContain(SECRET_NOTE);
      expect(text).not.toContain("Photos of the goals");
      expect(text).not.toContain("Test operator");
    }
  });

  it.each([
    ["a date in the future", { verifiedBy: "x", verifiedOn: "2999-01-01", confidence: "high" }],
    ["an unknown confidence", { verifiedBy: "x", verifiedOn: "2026-10-30", confidence: "certain" }],
    ["an unknown field", { verifiedBy: "x", verifiedOn: "2026-10-30", confidence: "high", verified: true }],
    ["an unknown source", { verifiedBy: "x", verifiedOn: "2026-10-30", confidence: "high", sourceId: randomUUID() }],
  ])("rejects %s with 400", async (_name, body) => {
    const { id } = await draftVenue(`verify-bad-${randomUUID().slice(0, 4)}`, 0);
    await fails(await verify(id, body), 400, "invalid_request");
  });

  it("404s an unknown venue", async () => {
    await fails(await verify(randomUUID()), 404, "not_found");
  });
});
