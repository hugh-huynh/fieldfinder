import { afterAll, describe, expect, it } from "vitest";

import { GET as getPitchRoute } from "@/app/api/venues/[venueSlug]/pitches/[pitchSlug]/route";
import { GET as getVenueRoute } from "@/app/api/venues/[venueSlug]/route";
import type { PitchDetailResponse, VenueDetailResponse } from "@/features/venues/detail";
import { venueRouteTarget } from "@/features/venues/route-target";
import type { ApiErrorBody } from "@/lib/api/errors";
import { publicDb } from "@/lib/db/public";

import { fixtures, PRIVATE_SENTINEL } from "../fixtures/venues";

// GET /api/venues/[venueSlug] and /pitches/[pitchSlug] against the seeded local database, connected
// as ff_public_reader exactly as the app is (PR 2.8). Slugs only, never ids. Run `pnpm db:reset` first.

const request = new Request("https://ff.test/api/venues/detail");

function getVenue(venueSlug: string): Promise<Response> {
  return getVenueRoute(request, { params: Promise.resolve({ venueSlug }) });
}

function getPitch(venueSlug: string, pitchSlug: string): Promise<Response> {
  return getPitchRoute(request, { params: Promise.resolve({ venueSlug, pitchSlug }) });
}

async function ok<T>(res: Response): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(200);
  expect(text).not.toContain(PRIVATE_SENTINEL);
  expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  return JSON.parse(text) as T;
}

async function expect404(res: Response): Promise<void> {
  const text = await res.text();
  expect(res.status, text).toBe(404);
  // Identical for every reason (draft, archived, no published pitch, missing), so nothing leaks.
  const body = JSON.parse(text) as ApiErrorBody;
  expect(body).toEqual({ code: "not_found", message: "Not found.", requestId: expect.any(String) as string });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(text).not.toContain(PRIVATE_SENTINEL);
}

const venue = (index: number) => {
  const found = fixtures.venues[index - 1];
  if (found === undefined) throw new Error(`no fixture venue ${String(index)}`);
  return found;
};

const VENUE_KEYS = [
  "access",
  "amenities",
  "description",
  "id",
  "location",
  "name",
  "postcode",
  "publishedPitchCount",
  "slug",
  "state",
  "streetAddress",
  "suburb",
  "updatedAt",
];
const PITCH_KEYS = [
  "access",
  "effectiveAccess",
  "floodlights",
  "id",
  "lengthMeters",
  "name",
  "pitchFormat",
  "slug",
  "surface",
  "updatedAt",
  "venueId",
  "venueSlug",
  "widthMeters",
];

afterAll(async () => {
  await publicDb().end({ timeout: 5 });
});

describe("GET /api/venues/[venueSlug]", () => {
  it("returns a published venue with its published pitches and allowlisted fields only", async () => {
    const body = await ok<VenueDetailResponse>(await getVenue("wattlebird-reserve"));

    expect(Object.keys(body).sort()).toEqual(["pitches", "venue"]);
    expect(Object.keys(body.venue).sort()).toEqual(VENUE_KEYS);
    expect(body.venue).toMatchObject({
      id: venue(1).id,
      name: "Wattlebird Reserve",
      streetAddress: "1 Example Parade",
      postcode: "3054",
      location: { latitude: -37.784, longitude: 144.972 },
      access: "public",
      publishedPitchCount: 1,
      // drinking_water is "unknown" in the fixture: omitted, never reported as "no".
      amenities: { cafe: "no", parking: "yes", toilets: "yes" },
    });
    expect(body.pitches).toHaveLength(1);
    expect(Object.keys(body.pitches[0] ?? {}).sort()).toEqual(PITCH_KEYS);
    expect(body.pitches[0]).toMatchObject({
      slug: "main-pitch",
      surface: "synthetic",
      pitchFormat: "full",
      lengthMeters: 105,
      widthMeters: 68,
      floodlights: true,
    });
  });

  it("does not look venues up by id", async () => {
    await expect404(await getVenue(venue(1).id));
  });

  it("lists only published pitches, ordered by name", async () => {
    const banksia = await ok<VenueDetailResponse>(await getVenue("banksias-corner-reserve"));
    expect(banksia.pitches.map((p) => p.slug)).toEqual(["north-pitch"]); // draft-pitch hidden
    expect(banksia.venue.name).toBe("Banksia's Corner Reserve");

    const saltbush = await ok<VenueDetailResponse>(await getVenue("saltbush-sports-park"));
    expect(saltbush.pitches.map((p) => p.slug)).toEqual(["east-pitch", "west-pitch"]); // old-pitch archived
    expect(saltbush.venue.publishedPitchCount).toBe(2);

    const ironbark = await ok<VenueDetailResponse>(await getVenue("ironbark-park"));
    expect(ironbark.pitches.map((p) => p.name)).toEqual(["Pitch A", "Pitch B", "Pitch C", "Pitch D"]);
  });

  it("keeps unknown values null", async () => {
    const body = await ok<VenueDetailResponse>(await getVenue("paperbark-common"));
    expect(body.venue).toMatchObject({ access: null, streetAddress: null, postcode: null, amenities: {} });
    expect(body.pitches[0]).toMatchObject({
      surface: null,
      pitchFormat: null,
      lengthMeters: null,
      widthMeters: null,
      floodlights: null,
      access: null,
      effectiveAccess: null,
    });
  });

  it.each([
    ["a draft venue", "hidden-draft-park"],
    ["an archived venue", "old-mill-oval"],
    ["a published venue with zero published pitches", "lilly-pilly-fields"],
    ["a slug that doesn't exist", "no-such-venue"],
  ])("404 for %s", async (_name, slug) => {
    await expect404(await getVenue(slug));
  });
});

describe("GET /api/venues/[venueSlug]/pitches/[pitchSlug]", () => {
  it("returns a published pitch with its venue's public details", async () => {
    const body = await ok<PitchDetailResponse>(await getPitch("wattlebird-reserve", "main-pitch"));

    expect(Object.keys(body).sort()).toEqual(["pitch", "venue"]);
    expect(Object.keys(body.pitch).sort()).toEqual(PITCH_KEYS);
    expect(Object.keys(body.venue).sort()).toEqual(VENUE_KEYS);
    expect(body.pitch).toMatchObject({ slug: "main-pitch", venueId: venue(1).id, venueSlug: "wattlebird-reserve" });
    expect(body.venue).toMatchObject({ slug: "wattlebird-reserve", amenities: { toilets: "yes", parking: "yes" } });
  });

  it("does not look venues or pitches up by id", async () => {
    await expect404(await getPitch(venue(1).id, "main-pitch"));
    await expect404(await getPitch("wattlebird-reserve", String(venue(1).pitches[0]?.id)));
  });

  it("resolves a uuid-shaped slug as a slug, even when it equals another pitch's id", async () => {
    // Ironbark's Pitch D has Pitch A's id as its slug (fixture 21).
    const pitchA = venue(2).pitches[0];
    expect(pitchA?.name).toBe("Pitch A");
    const body = await ok<PitchDetailResponse>(await getPitch("ironbark-park", String(pitchA?.id)));
    expect(body.pitch).toMatchObject({ name: "Pitch D", slug: pitchA?.id });
    expect(body.pitch.id).not.toBe(pitchA?.id);
  });

  it("shows access inheritance: own value null, effective value from the venue", async () => {
    const inherits = await ok<PitchDetailResponse>(await getPitch("kurrajong-recreation-ground", "oval-1"));
    expect(inherits.pitch).toMatchObject({ access: null, effectiveAccess: "booking_required" });
    const overrides = await ok<PitchDetailResponse>(await getPitch("kurrajong-recreation-ground", "oval-2"));
    expect(overrides.pitch).toMatchObject({ access: "members_only", effectiveAccess: "members_only" });
  });

  it("resolves a pitch slug within its own venue only", async () => {
    // "pitch-1" exists at several venues; each resolves to that venue's pitch.
    const redGum = await ok<PitchDetailResponse>(await getPitch("red-gum-flats", "pitch-1"));
    const greyBox = await ok<PitchDetailResponse>(await getPitch("grey-box-fields", "pitch-1"));
    expect(redGum.pitch.venueSlug).toBe("red-gum-flats");
    expect(greyBox.pitch.venueSlug).toBe("grey-box-fields");
    expect(redGum.pitch.id).not.toBe(greyBox.pitch.id);
  });

  it.each([
    ["a draft pitch at a published venue", "banksias-corner-reserve", "draft-pitch"],
    ["an archived pitch at a published venue", "saltbush-sports-park", "old-pitch"],
    ["a draft pitch at a venue with no published pitch", "lilly-pilly-fields", "pitch-1"],
    ["a published pitch under a draft venue", "hidden-draft-park", "pitch-1"],
    ["a published pitch under an archived venue", "old-mill-oval", "pitch-1"],
    ["a pitch slug that doesn't exist", "wattlebird-reserve", "no-such-pitch"],
    ["a venue that doesn't exist", "no-such-venue", "pitch-1"],
  ])("404 for %s", async (_name, venueSlug, pitchSlug) => {
    await expect404(await getPitch(venueSlug, pitchSlug));
  });

  it("404 for a published pitch slug requested under another venue", async () => {
    await expect404(await getPitch("wattlebird-reserve", "pitch-a")); // Ironbark's
  });
});

describe("route target from live data", () => {
  it.each([
    ["one published pitch", "wattlebird-reserve", "/venues/wattlebird-reserve/pitches/main-pitch"],
    // A draft pitch doesn't count, so this venue still goes straight to its only published pitch.
    [
      "one published pitch plus a draft",
      "banksias-corner-reserve",
      "/venues/banksias-corner-reserve/pitches/north-pitch",
    ],
    // An archived pitch doesn't count either.
    ["two published pitches plus an archived one", "saltbush-sports-park", "/venues/saltbush-sports-park"],
    ["four published pitches", "ironbark-park", "/venues/ironbark-park"],
  ])("%s → %s", async (_name, slug, target) => {
    const body = await ok<VenueDetailResponse>(await getVenue(slug));
    expect(
      venueRouteTarget(
        body.venue.slug,
        body.pitches.map((p) => p.slug),
      ),
    ).toBe(target);
  });
});
