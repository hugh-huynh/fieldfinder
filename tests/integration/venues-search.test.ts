import { afterAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/venues/route";
import type { VenueSearchResponse } from "@/features/search/search";
import type { ApiErrorBody } from "@/lib/api/errors";
import { publicDb } from "@/lib/db/public";

import { fixtureId } from "../fixtures/factory";
import { fixtures, ORIGIN, PRIVATE_SENTINEL } from "../fixtures/venues";
import { LOCAL_MEDIA_PUBLIC_BASE_URL as MEDIA_BASE } from "../setup/integration-env";

// GET /api/venues against the seeded local database, connected as ff_public_reader exactly as the
// app is (PR 2.7). Seed: tests/fixtures/venues.ts → supabase/seed.sql. Run `pnpm db:reset` first.

// Canonical spelling of the fixture origin (3 dp); other spellings get a 308 to this form.
const LAT = Math.round(ORIGIN.latitude * 1000) / 1000;
const LNG = Math.round(ORIGIN.longitude * 1000) / 1000;
const BASE = `lat=${String(LAT)}&lng=${String(LNG)}`;

async function get(query: string): Promise<Response> {
  return GET(new Request(`https://ff.test/api/venues?${query}`), { params: Promise.resolve({}) });
}

async function search(query: string): Promise<VenueSearchResponse> {
  const res = await get(query);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as VenueSearchResponse;
}

const slugs = (body: VenueSearchResponse) => body.items.map((item) => item.slug);

const slugOf = (index: number) => {
  const venue = fixtures.venues[index - 1];
  if (venue === undefined) throw new Error(`no fixture venue ${String(index)}`);
  return venue.slug;
};

afterAll(async () => {
  await publicDb().end({ timeout: 5 });
});

describe("GET /api/venues — results", () => {
  it("returns published venues with a published pitch inside the default 10 km, nearest first", async () => {
    const body = await search(BASE);

    // Fixtures 1, 2, 3, 7, 8, 9, 10 are public and within 10 km; 4 (draft pitches only), 5 (draft),
    // 6 (archived) are never public; 11–14 are further away.
    expect(new Set(slugs(body))).toEqual(new Set([1, 2, 3, 7, 8, 9, 10].map(slugOf)));
    expect(body.totalCount).toBe(7);
    expect(body.nextCursor).toBeNull();
    const distances = body.items.map((item) => item.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("widens with radiusKm and stops at the 50 km maximum", async () => {
    const wide = await search(`${BASE}&radiusKm=50&limit=30`);
    expect(wide.totalCount).toBe(10);
    expect(slugs(wide)).not.toContain(slugOf(14)); // Geelong, ~60 km
  });

  it("excludes a venue whose filters are only met by different pitches (same-pitch rule)", async () => {
    const body = await search(`${BASE}&surface=synthetic&lighting=yes`);

    // Ironbark Park (2) has a synthetic unlit pitch and a lit grass pitch, but no synthetic AND lit pitch.
    expect(slugs(body)).not.toContain(slugOf(2));
    expect(slugs(body)).toContain(slugOf(1));
    expect(slugs(body)).toContain(slugOf(9));
    const wattlebird = body.items.find((item) => item.slug === slugOf(1));
    expect(wattlebird).toMatchObject({ publishedPitchCount: 1, matchingPitchCount: 1 });
  });

  it("treats unknown attributes as not matching and applies access inheritance", async () => {
    // Paperbark Common (7) has a pitch with every attribute unknown.
    for (const filter of ["surface=grass", "pitchSize=full", "lighting=no", "access=public"]) {
      expect(slugs(await search(`${BASE}&${filter}`)), filter).not.toContain(slugOf(7));
    }
    // Kurrajong (8): Oval 1 inherits booking_required from the venue; Oval 2 overrides to members_only.
    const booking = await search(`${BASE}&access=booking_required`);
    expect(slugs(booking)).toEqual([slugOf(8)]);
    expect(booking.items[0]).toMatchObject({ publishedPitchCount: 2, matchingPitchCount: 1 });
  });

  it("links single-pitch venues to the pitch page and others to the venue page, whatever the filters", async () => {
    const hrefs = (body: VenueSearchResponse) => Object.fromEntries(body.items.map((item) => [item.slug, item.href]));

    const all = hrefs(await search(BASE));
    expect(all[slugOf(1)]).toBe("/venues/wattlebird-reserve/pitches/main-pitch");
    // Banksia has one published pitch and a draft one: the draft doesn't count.
    expect(all[slugOf(3)]).toBe("/venues/banksias-corner-reserve/pitches/north-pitch");
    expect(all[slugOf(2)]).toBe("/venues/ironbark-park");
    // Saltbush has two published pitches and an archived one.
    expect(all[slugOf(9)]).toBe("/venues/saltbush-sports-park");

    // Only one of Ironbark's pitches is hybrid, but it still has four published pitches.
    const filtered = hrefs(await search(`${BASE}&surface=hybrid`));
    expect(filtered[slugOf(2)]).toBe("/venues/ironbark-park");
  });

  it("filters amenities on confirmed 'yes' only and lists confirmed amenities per venue", async () => {
    const body = await search(`${BASE}&amenities=parking,toilets`);
    expect(new Set(slugs(body))).toEqual(new Set([slugOf(1), slugOf(9)]));

    const wattlebird = body.items.find((item) => item.slug === slugOf(1));
    // drinking_water is "unknown" in the fixture, so it's omitted, never reported as "no".
    expect(wattlebird?.amenities).toEqual({ parking: "yes", toilets: "yes", cafe: "no" });
  });

  it("returns an empty page, not an error, when nothing matches", async () => {
    const body = await search(`${BASE}&radiusKm=1`);
    expect(body).toEqual({ items: [], totalCount: 0, nextCursor: null });
  });

  it("exposes only allowlisted fields and nothing private", async () => {
    const res = await get(`${BASE}&radiusKm=50&limit=30`);
    const text = await res.clone().text();
    const body = (await res.json()) as VenueSearchResponse;

    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor", "totalCount"]);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        "access",
        "amenities",
        "distanceMeters",
        "href",
        "id",
        "image",
        "location",
        "matchingPitchCount",
        "name",
        "publishedPitchCount",
        "slug",
        "state",
        "suburb",
      ]);
    }
    expect(text).not.toContain(PRIVATE_SENTINEL);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  });
});

describe("GET /api/venues — images (PR 2.12)", () => {
  it("gives each venue its first published image, or null, never a draft", async () => {
    const body = await search(`${BASE}&radiusKm=50&limit=30`);
    const bySlug = Object.fromEntries(body.items.map((item) => [item.slug, item.image]));
    // Wattlebird: published venue image 1 (order 0); image 2 is a draft and must never appear.
    expect(bySlug[slugOf(1)]).toMatchObject({
      id: fixtureId("media", 1),
      url: `${MEDIA_BASE}/fixtures/public/${fixtureId("media", 1)}.webp`,
      alt: "Entrance gates and car park",
      attribution: null,
    });
    // Saltbush has a venue image; Paperbark has no images at all.
    expect(bySlug[slugOf(9)]).toMatchObject({ id: fixtureId("media", 7) });
    expect(bySlug[slugOf(7)]).toBeNull();
    expect(JSON.stringify(body)).not.toContain(fixtureId("media", 2));
  });
});

describe("GET /api/venues — one URL per search", () => {
  it("redirects other spellings to the canonical URL, which returns the same results", async () => {
    const res = await get(
      `lng=${String(ORIGIN.longitude)}&lat=${String(ORIGIN.latitude)}&radiusKm=010&amenities=toilets%2Cparking`,
    );
    expect(res.status).toBe(308);
    const location = res.headers.get("location");
    expect(location).toBe(`/api/venues?${BASE}&amenities=parking,toilets`);

    const followed = await search(String(location).split("?")[1] ?? "");
    expect(followed).toEqual(await search(`${BASE}&amenities=parking,toilets`));
  });
});

describe("GET /api/venues — pagination", () => {
  it("walks every match exactly once, in order, with no gaps or duplicates", async () => {
    const query = `${BASE}&radiusKm=50`;
    const all = await search(`${query}&limit=30`);
    expect(all.items).toHaveLength(10);

    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await search(`${query}&limit=3${cursor === null ? "" : `&cursor=${cursor}`}`);
      expect(page.totalCount).toBe(10);
      walked.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(4); // 3 + 3 + 3 + 1, and no trailing empty page
    expect(walked).toEqual(all.items.map((item) => item.id));
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("ends on a full last page without handing out a cursor to an empty page", async () => {
    const first = await search(`${BASE}&radiusKm=50&limit=5`);
    expect(first.items).toHaveLength(5);
    const second = await search(`${BASE}&radiusKm=50&limit=5&cursor=${String(first.nextCursor)}`);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps a cursor valid when only the page size changes", async () => {
    const first = await search(`${BASE}&radiusKm=50&limit=4`);
    const rest = await search(`${BASE}&radiusKm=50&limit=30&cursor=${String(first.nextCursor)}`);
    expect(rest.items).toHaveLength(6);
    expect(rest.nextCursor).toBeNull();
  });
});

describe("GET /api/venues — cursor misuse → 400", () => {
  async function firstCursor(query: string): Promise<string> {
    const body = await search(`${query}&limit=2`);
    expect(body.nextCursor).not.toBeNull();
    return String(body.nextCursor);
  }

  async function expectCursor400(query: string): Promise<void> {
    const res = await get(query);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorBody;
    expect(body).toMatchObject({ code: "invalid_request", message: "Invalid request parameters: cursor" });
  }

  it("rejects a tampered cursor", async () => {
    const cursor = await firstCursor(`${BASE}&radiusKm=50`);
    const [payload = "", signature = ""] = cursor.split(".");
    // Rewrite the payload to skip ahead, keeping the old signature.
    const forged = Buffer.from(JSON.stringify({ d: 0, id: fixtures.venues[0]?.id, n: 1 })).toString("base64url");
    await expectCursor400(`${BASE}&radiusKm=50&cursor=${forged}.${signature}`);
    // Flip one signature character.
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    await expectCursor400(`${BASE}&radiusKm=50&cursor=${payload}.${flipped}`);
    await expectCursor400(`${BASE}&radiusKm=50&cursor=${payload}`);
  });

  it("rejects a cursor reused with different filters, radius or centre", async () => {
    const cursor = await firstCursor(`${BASE}&radiusKm=50`);
    await expectCursor400(`${BASE}&radiusKm=50&surface=grass&cursor=${cursor}`);
    await expectCursor400(`${BASE}&radiusKm=49&cursor=${cursor}`);
    await expectCursor400(`lat=-37.9&lng=${String(LNG)}&radiusKm=50&cursor=${cursor}`);
  });
});
