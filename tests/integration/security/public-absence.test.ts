import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getPitchRoute } from "@/app/api/venues/[venueSlug]/pitches/[pitchSlug]/route";
import { GET as getVenueRoute } from "@/app/api/venues/[venueSlug]/route";
import { publicDb } from "@/lib/db/public";

import { PRIVATE_SENTINEL } from "../../fixtures/venues";

import { allKeys, crawlPublicApi, loadTruth, type Exchange, type Truth } from "./crawl";

// Security sweep (PR 2.15, spec §4 and §6): nothing that isn't public may be reachable or visible
// through any public data route, whatever the reason it isn't public (draft, archived, a venue with
// no published pitch, a pitch under an unpublished venue, a draft or archived image). The expected
// public set comes from the base tables (crawl.ts), not from the views being tested.
// GET /api/locations/suggest is left out: it serves Mapbox's data, none of ours.

/** Field names that exist only on private records or admin DTOs. None may appear in a public body. */
const PRIVATE_FIELDS = [
  "status",
  "version",
  "storageKey",
  "storage_key",
  "publicKey",
  "public_key",
  "evidence",
  "evidenceRef",
  "evidence_ref",
  "internalNotes",
  "internal_notes",
  "verifiedBy",
  "verified_by",
  "verifiedOn",
  "confidence",
  "rights",
  "rightsBasis",
  "rights_basis",
  "commercialUseOk",
  "commercial_use_ok",
  "byteSize",
  "createdAt",
  "created_at",
  "sourceId",
];

let truth: Truth;
let exchanges: Exchange[];

beforeAll(async () => {
  truth = await loadTruth();
  exchanges = await crawlPublicApi(truth);
}, 60_000);

afterAll(async () => {
  await publicDb().end({ timeout: 5 });
});

const bodies = () => exchanges.map((e) => ({ target: e.target, text: e.text }));

describe("the fixtures exercise every hidden state", () => {
  it("has public and non-public venues, pitches and images to tell apart", () => {
    for (const records of [truth.venues, truth.pitches, truth.media]) {
      expect(records.some((r) => r.isPublic)).toBe(true);
      expect(records.some((r) => !r.isPublic)).toBe(true);
    }
  });
});

describe("search returns exactly the public venues", () => {
  it("finds every public venue and no other, from every venue's own location", () => {
    const found = new Set<string>();
    for (const e of exchanges.filter((x) => x.endpoint === "search")) {
      expect(e.status, e.target).toBe(200);
      for (const item of (JSON.parse(e.text) as { items: { id: string }[] }).items) found.add(item.id);
    }
    const expected = truth.venues.filter((v) => v.isPublic).map((v) => v.id);
    expect([...found].sort()).toEqual(expected.sort());
  });
});

describe("detail pages exist only for public records", () => {
  it("serves every public venue and 404s every other", () => {
    for (const venue of truth.venues) {
      const e = exchanges.find((x) => x.target === `venue ${venue.slug}`);
      expect(e?.status, `venue ${venue.slug}`).toBe(venue.isPublic ? 200 : 404);
    }
  });

  it("serves every public pitch and 404s every other", () => {
    for (const pitch of truth.pitches) {
      const e = exchanges.find((x) => x.target === `pitch ${pitch.venueSlug}/${pitch.slug}`);
      expect(e?.status, `pitch ${pitch.venueSlug}/${pitch.slug}`).toBe(pitch.isPublic ? 200 : 404);
    }
  });

  it("gives a hidden record the same 404 as one that never existed, so status can't be probed", async () => {
    const hidden = truth.venues.find((v) => !v.isPublic);
    const hiddenPitch = truth.pitches.find((p) => !p.isPublic && truth.venues.some((v) => v.slug === p.venueSlug));
    expect(hidden).toBeDefined();
    expect(hiddenPitch).toBeDefined();
    const request = new Request("https://ff.test/api/venues/detail");
    const strip = async (res: Response) => {
      const body = (await res.json()) as Record<string, unknown>;
      delete body.requestId;
      return { status: res.status, cacheControl: res.headers.get("cache-control"), body };
    };
    const missingVenue = await strip(
      await getVenueRoute(request, { params: Promise.resolve({ venueSlug: "no-such-venue-anywhere" }) }),
    );
    const missingPitch = await strip(
      await getPitchRoute(request, {
        params: Promise.resolve({ venueSlug: hiddenPitch?.venueSlug ?? "", pitchSlug: "no-such-pitch-anywhere" }),
      }),
    );
    expect(
      await strip(await getVenueRoute(request, { params: Promise.resolve({ venueSlug: hidden?.slug ?? "" }) })),
    ).toEqual(missingVenue);
    expect(
      await strip(
        await getPitchRoute(request, {
          params: Promise.resolve({ venueSlug: hiddenPitch?.venueSlug ?? "", pitchSlug: hiddenPitch?.slug ?? "" }),
        }),
      ),
    ).toEqual(missingPitch);
  });
});

describe("no public response carries anything private", () => {
  it("never contains the private-value marker", () => {
    for (const { target, text } of bodies()) expect(text, target).not.toContain(PRIVATE_SENTINEL);
  });

  it("never mentions a non-public venue, pitch or image by id", () => {
    const hiddenIds = [...truth.venues, ...truth.pitches, ...truth.media].filter((r) => !r.isPublic).map((r) => r.id);
    expect(hiddenIds.length).toBeGreaterThan(0);
    for (const { target, text } of bodies()) {
      for (const id of hiddenIds) expect(text, `${target} mentions ${id}`).not.toContain(id);
    }
  });

  it("never reveals a private storage key, or the public key of an image that isn't public", () => {
    const secrets = [
      ...truth.media.map((m) => m.storageKey),
      ...truth.media.filter((m) => !m.isPublic && m.publicKey !== null).map((m) => m.publicKey ?? ""),
    ];
    for (const { target, text } of bodies()) {
      for (const secret of secrets) expect(text, `${target} reveals ${secret}`).not.toContain(secret);
    }
  });

  it("links only images that are public", () => {
    const publicKeys = truth.media.filter((m) => m.isPublic && m.publicKey !== null).map((m) => m.publicKey ?? "");
    for (const { target, text } of bodies()) {
      for (const url of text.match(/"url":"[^"]+"/g) ?? []) {
        expect(
          publicKeys.some((key) => url.endsWith(`/${key}"`)),
          `${target}: ${url}`,
        ).toBe(true);
      }
    }
  });

  it("uses no private or admin-only field names", () => {
    for (const e of exchanges.filter((x) => x.status === 200)) {
      const keys = allKeys(JSON.parse(e.text));
      for (const field of PRIVATE_FIELDS) expect(keys.has(field), `${e.target} has "${field}"`).toBe(false);
    }
  });

  it("returns only the error shape when it refuses", () => {
    for (const e of exchanges.filter((x) => x.status !== 200)) {
      expect(Object.keys(JSON.parse(e.text) as object).sort(), e.target).toEqual(["code", "message", "requestId"]);
    }
  });
});
