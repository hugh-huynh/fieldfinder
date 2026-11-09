import { randomUUID } from "node:crypto";

import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as publishMediaRoute } from "@/app/api/admin/media/[id]/publish/route";
import { PATCH as patchMediaRoute } from "@/app/api/admin/media/[id]/route";
import { POST as unpublishMediaRoute } from "@/app/api/admin/media/[id]/unpublish/route";
import { POST as uploadRoute } from "@/app/api/admin/media/route";
import { POST as archiveVenueRoute } from "@/app/api/admin/venues/[id]/archive/route";
import { POST as createPitchRoute } from "@/app/api/admin/venues/[id]/pitches/route";
import { POST as publishVenueRoute } from "@/app/api/admin/venues/[id]/publish/route";
import { POST as verifyRoute } from "@/app/api/admin/venues/[id]/verifications/route";
import { POST as createVenueRoute } from "@/app/api/admin/venues/route";
import { GET as searchRoute } from "@/app/api/venues/route";
import { GET as publicVenueRoute } from "@/app/api/venues/[venueSlug]/route";
import type { AdminMediaDto } from "@/features/media/admin-dto";
import type { AdminPitchDto } from "@/features/pitches/admin-dto";
import type { VenueSearchResponse } from "@/features/search/search";
import type { AdminVenueDto } from "@/features/venues/admin-dto";
import type { VenueDetailResponse } from "@/features/venues/detail";
import type { ApiErrorBody } from "@/lib/api/errors";
import { generateToken, hashToken } from "@/lib/auth/token";
import { adminDb } from "@/lib/db/admin";
import { publicDb } from "@/lib/db/public";
import { storageConfig } from "@/lib/env";
import { createS3MediaStore } from "@/lib/storage/s3";
import { PRIVATE_BUCKET, PUBLIC_BUCKET } from "@/lib/storage/types";

import { LOCAL_ADMIN_URL } from "../setup/integration-env";

// Media upload, storage and publishing against local Supabase (Postgres + Storage) (PR 2.12).
// Acceptance: polyglot / SVG / oversize uploads rejected; output has no EXIF; unpublished media has
// no public URL anywhere in the public DTO. Test venues are in Broome so search there sees only them.

const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });
const store = createS3MediaStore(storageConfig());
const run = randomUUID().slice(0, 8);
const slug = (name: string) => `media-${run}-${name}`;
const SEARCH = "lat=-17.962&lng=122.236";
const EVIDENCE = `evidence/${run}/site-visit-photos`;

let token: string; // every scope
let noMedia: string; // venues:write, pitches:write, content:publish (no media:write)

async function mint(scopes: string[]): Promise<string> {
  const t = generateToken();
  await operator`
    insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values (${`media-${run}-${randomUUID().slice(0, 6)}`}, ${hashToken(t)}, ${scopes}, now() + interval '1 day')
  `;
  return t;
}

type Headers = Record<string, string>;
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

function json(method: string, path: string, body?: unknown, headers: Headers = {}): Request {
  return new Request(`https://ff.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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

async function fails(res: Response, status: number, code: string): Promise<ApiErrorBody> {
  const body = (await res.json()) as ApiErrorBody;
  expect(res.status, JSON.stringify(body)).toBe(status);
  expect(body.code).toBe(code);
  return body;
}

/** A JPEG carrying camera EXIF and GPS coordinates. */
const jpegWithGps = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 140, b: 70 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestCam", Copyright: `owner-${run}` },
      IFD3: {
        GPSLatitudeRef: "S",
        GPSLatitude: "17/1 57/1 43/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "122/1 14/1 9/1",
      },
    })
    .toBuffer();

function upload(
  file: Uint8Array | null,
  fields: Record<string, string>,
  opts: { auth?: string; filename?: string; type?: string } = {},
) {
  const form = new FormData();
  if (file !== null)
    form.append(
      "file",
      new File([new Uint8Array(file)], opts.filename ?? "photo.jpg", { type: opts.type ?? "image/jpeg" }),
    );
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return uploadRoute(
    new Request("https://ff.test/api/admin/media", {
      method: "POST",
      headers: { authorization: `Bearer ${opts.auth ?? token}` },
      body: form,
    }),
    params({}),
  );
}

const patchMedia = (id: string, etag: string, body: unknown) =>
  patchMediaRoute(json("PATCH", `/api/admin/media/${id}`, body, { "if-match": etag }), params({ id }));
const publishMedia = (id: string, etag: string) =>
  publishMediaRoute(json("POST", `/api/admin/media/${id}/publish`, undefined, { "if-match": etag }), params({ id }));
const unpublishMedia = (id: string, etag: string) =>
  unpublishMediaRoute(
    json("POST", `/api/admin/media/${id}/unpublish`, undefined, { "if-match": etag }),
    params({ id }),
  );

async function publicVenue(venueSlug: string): Promise<VenueDetailResponse> {
  return ok<VenueDetailResponse>(await publicVenueRoute(new Request("https://ff.test/"), params({ venueSlug })));
}

async function searchItem(venueSlug: string) {
  const body = await ok<VenueSearchResponse>(
    await searchRoute(new Request(`https://ff.test/api/venues?${SEARCH}`), params({})),
  );
  return body.items.find((item) => item.slug === venueSlug);
}

const keys = (id: string) =>
  operator<{ storage_key: string; public_key: string | null; status: string }[]>`
    select storage_key, public_key, status::text from public.media_assets where id = ${id}::uuid
  `.then(([row]) => row);

/** A published venue in Broome with one published pitch. */
async function publicVenueWithPitch(
  name: string,
): Promise<{ id: string; slug: string; pitchId: string; etag: string }> {
  const { venue } = await ok<{ venue: AdminVenueDto }>(
    await createVenueRoute(
      json("POST", "/api/admin/venues", {
        slug: slug(name),
        name: `Media ${name}`,
        suburb: "Broome",
        state: "WA",
        latitude: -17.96,
        longitude: 122.24,
      }),
      params({}),
    ),
    201,
  );
  const { pitch } = await ok<{ pitch: AdminPitchDto }>(
    await createPitchRoute(
      json("POST", `/api/admin/venues/${venue.id}/pitches`, { slug: "pitch-1", name: "Pitch 1" }),
      params({ id: venue.id }),
    ),
    201,
  );
  await ok(
    await verifyRoute(
      json("POST", `/api/admin/venues/${venue.id}/verifications`, {
        verifiedBy: "Test operator",
        verifiedOn: "2026-11-01",
        confidence: "high",
      }),
      params({ id: venue.id }),
    ),
    201,
  );
  const published = await publishVenueRoute(
    json(
      "POST",
      `/api/admin/venues/${venue.id}/publish`,
      { pitches: [{ id: pitch.id, version: pitch.version }] },
      { "if-match": `"${venue.version}"` },
    ),
    params({ id: venue.id }),
  );
  await ok(published);
  return { id: venue.id, slug: slug(name), pitchId: pitch.id, etag: String(published.headers.get("etag")) };
}

beforeAll(async () => {
  token = await mint(["venues:write", "pitches:write", "media:write", "content:publish"]);
  noMedia = await mint(["venues:write", "pitches:write", "content:publish"]);
});

afterAll(async () => {
  const media = await operator<{ storage_key: string; public_key: string | null }[]>`
    select m.storage_key, m.public_key from public.media_assets m
    left join public.pitches p on p.id = m.pitch_id
    join public.venues v on v.id = coalesce(m.venue_id, p.venue_id)
    where v.slug like ${`media-${run}-%`}
  `;
  for (const m of media) {
    await store.delete(PRIVATE_BUCKET, m.storage_key);
    if (m.public_key !== null) await store.delete(PUBLIC_BUCKET, m.public_key);
  }
  const venues = operator`select id from public.venues where slug like ${`media-${run}-%`}`;
  await operator`delete from public.media_assets where venue_id in (${venues}) or pitch_id in (select id from public.pitches where venue_id in (${venues}))`;
  await operator`delete from public.field_verifications where venue_id in (${venues})`;
  await operator`delete from public.pitches where venue_id in (${venues})`;
  await operator`delete from public.venues where slug like ${`media-${run}-%`}`;
  await operator.end({ timeout: 5 });
  await adminDb().end({ timeout: 5 });
  await publicDb().end({ timeout: 5 });
});

describe("image lifecycle (acceptance)", () => {
  it("stores a clean private draft, publishes a public copy, and removes it again on unpublish", async () => {
    const venue = await publicVenueWithPitch("lifecycle");

    // Upload: a re-encoded, metadata-free WebP in the private bucket; no public URL anywhere.
    const uploaded = await upload(new Uint8Array(await jpegWithGps()), {
      venueId: venue.id,
      altText: "Goals at the north end",
    });
    const { media } = await ok<{ media: AdminMediaDto }>(uploaded, 201);
    expect(media).toMatchObject({
      status: "draft",
      publicUrl: null,
      contentType: "image/webp",
      width: 64,
      height: 48,
      alt: "Goals at the north end",
    });
    expect(Object.keys(media)).not.toContain("storageKey");

    const stored = await keys(media.id);
    expect(stored?.public_key).toBeNull();
    const privateBytes = await store.get(PRIVATE_BUCKET, String(stored?.storage_key));
    expect(privateBytes).not.toBeNull();
    const meta = await sharp(privateBytes ?? new Uint8Array()).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined(); // GPS and camera EXIF are gone
    expect(Buffer.from(privateBytes ?? []).includes(`owner-${run}`)).toBe(false);

    expect((await publicVenue(venue.slug)).media).toEqual([]);
    expect((await searchItem(venue.slug))?.image).toBeNull();

    // Publishing needs complete rights.
    await fails(await publishMedia(media.id, `"${media.version}"`), 409, "conflict");
    expect((await keys(media.id))?.public_key).toBeNull();

    const patched = await patchMedia(media.id, `"${media.version}"`, {
      rightsBasis: "owned",
      evidenceRef: EVIDENCE,
      commercialUseOk: true,
    });
    await ok(patched);

    // Publish: a copy under an unguessable key, served publicly and listed in public responses.
    const published = await publishMedia(media.id, String(patched.headers.get("etag")));
    const { media: live } = await ok<{ media: AdminMediaDto }>(published);
    expect(live.status).toBe("published");
    expect(live.publicUrl).toMatch(/\/media-public\/p\/[A-Za-z0-9_-]{32}\.webp$/);

    const fetched = await fetch(String(live.publicUrl));
    expect(fetched.status).toBe(200);
    const publicBytes = new Uint8Array(await fetched.arrayBuffer());
    expect((await sharp(publicBytes).metadata()).exif).toBeUndefined();

    const detail = await publicVenue(venue.slug);
    expect(detail.media).toEqual([
      expect.objectContaining({ id: media.id, url: live.publicUrl, alt: "Goals at the north end", attribution: null }),
    ]);
    expect((await searchItem(venue.slug))?.image).toMatchObject({ id: media.id, url: live.publicUrl });
    const publicText = JSON.stringify(detail);
    expect(publicText).not.toContain(EVIDENCE);
    expect(publicText).not.toContain(String(stored?.storage_key));

    // Unpublish: the public copy is deleted and the image disappears from public responses.
    const unpublished = await unpublishMedia(media.id, String(published.headers.get("etag")));
    expect((await ok<{ media: AdminMediaDto }>(unpublished)).media).toMatchObject({ status: "draft", publicUrl: null });
    expect((await fetch(String(live.publicUrl))).ok).toBe(false);
    expect((await publicVenue(venue.slug)).media).toEqual([]);
    expect((await searchItem(venue.slug))?.image).toBeNull();

    const audit = await operator<{ transition: string }[]>`
      select from_status || '→' || to_status as transition from public.field_publications
      where entity_type = 'media_asset' and entity_id = ${media.id}::uuid order by id
    `;
    expect(audit.map((a) => a.transition)).toEqual(["draft→published", "published→draft"]);
  });
});

describe("POST /api/admin/media — refusals", () => {
  let venueId: string;

  beforeAll(async () => {
    venueId = (await publicVenueWithPitch("refusals")).id;
  });

  it.each([
    [
      "an SVG",
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      "logo.svg",
      "image/svg+xml",
    ],
    [
      "HTML named .jpg",
      new TextEncoder().encode("<!doctype html><script>alert(1)</script>"),
      "photo.jpg",
      "image/jpeg",
    ],
  ])("%s → 400, nothing stored", async (_name, file, filename, type) => {
    const before = await operator<{ n: number }[]>`select count(*)::int as n from public.media_assets`;
    await fails(await upload(file, { venueId, altText: "x" }, { filename, type }), 400, "invalid_request");
    const after = await operator<{ n: number }[]>`select count(*)::int as n from public.media_assets`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("a polyglot (a real JPEG with a ZIP/script appended) → 400", async () => {
    const jpeg = new Uint8Array(await jpegWithGps());
    const payload = new TextEncoder().encode("PK\u0003\u0004<script>alert(1)</script>");
    const polyglot = new Uint8Array(jpeg.length + payload.length);
    polyglot.set(jpeg);
    polyglot.set(payload, jpeg.length);
    await fails(await upload(polyglot, { venueId, altText: "x" }), 400, "invalid_request");
  });

  it("an upload over 10 MB → 400", async () => {
    await fails(
      await upload(new Uint8Array(10 * 1024 * 1024 + 1).fill(0xff), { venueId, altText: "x" }),
      400,
      "invalid_request",
    );
  });

  it("no file, two owners or no alt text → 400; no media:write scope → 403", async () => {
    const jpeg = new Uint8Array(await jpegWithGps());
    await fails(await upload(null, { venueId, altText: "x" }), 400, "invalid_request");
    await fails(await upload(jpeg, { venueId, pitchId: randomUUID(), altText: "x" }), 400, "invalid_request");
    await fails(await upload(jpeg, { venueId }), 400, "invalid_request");
    await fails(await upload(jpeg, { venueId, altText: "x" }, { auth: noMedia }), 403, "forbidden");
  });

  it("an unknown owner → 404; an archived venue → 409", async () => {
    const jpeg = new Uint8Array(await jpegWithGps());
    await fails(await upload(jpeg, { venueId: randomUUID(), altText: "x" }), 404, "not_found");
    const archived = await publicVenueWithPitch("archived");
    await ok(
      await archiveVenueRoute(
        json("POST", `/api/admin/venues/${archived.id}/archive`, undefined, { "if-match": archived.etag }),
        params({ id: archived.id }),
      ),
    );
    await fails(await upload(jpeg, { venueId: archived.id, altText: "x" }), 409, "conflict");
  });
});

describe("pitch images and idempotency", () => {
  it("accepts a pitch image, and replays a retried upload without storing it twice", async () => {
    const venue = await publicVenueWithPitch("pitch-image");
    const file = new Uint8Array(await jpegWithGps());
    const headers = { "idempotency-key": `media-${run}-upload-1` };
    const send = () => {
      const form = new FormData();
      form.append("file", new File([file], "pitch.jpg", { type: "image/jpeg" }));
      form.append("pitchId", venue.pitchId);
      form.append("altText", "Pitch 1 from the halfway line");
      return uploadRoute(
        new Request("https://ff.test/api/admin/media", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, ...headers },
          body: form,
        }),
        params({}),
      );
    };
    const first = await ok<{ media: AdminMediaDto }>(await send(), 201);
    expect(first.media).toMatchObject({ pitchId: first.media.pitchId, venueId: null, status: "draft" });
    const retry = await send();
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(await ok<{ media: AdminMediaDto }>(retry, 201)).toEqual(first);
    const [count] = await operator<
      { n: number }[]
    >`select count(*)::int as n from public.media_assets where pitch_id = ${venue.pitchId}::uuid`;
    expect(count?.n).toBe(1);
  });
});
