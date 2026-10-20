import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { encodeCursor } from "./cursor";
import { canonicalSearchKey, parseSearchQuery, type SearchQuery } from "./query";
import { searchVenues } from "./search";

// Edge cases that the seeded database can't produce on demand. Normal behaviour is covered against
// real data in tests/integration/venues-search.test.ts.

const SECRET = "unit-test-secret-unit-test-secret-0123";
const ID = "5eed0000-0000-4000-8000-000000000001";

function query(qs: string): SearchQuery {
  const parsed = parseSearchQuery(new URLSearchParams(`lat=-37.8136&lng=144.9631&${qs}`));
  if (!parsed.ok) throw new Error("bad test query");
  return parsed.query;
}

const row = {
  venue_id: ID,
  slug: "wattlebird-reserve",
  name: "Wattlebird Reserve",
  suburb: "Carlton North",
  state: "VIC",
  latitude: -37.784,
  longitude: 144.972,
  access: "public",
  distance_m: 3411.6,
  published_pitch_count: 1,
  matching_pitch_count: 1,
  single_pitch_slug: "main-pitch",
  total_count: "7",
};

/** Fake postgres.js tagged template: answers search_venues() calls with `answer(afterId)`. */
function fakeSql(answer: (afterId: unknown) => unknown[]) {
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("search_venues")) return Promise.resolve(answer(values[9]));
    return Promise.resolve([]); // amenities lookup
  });
  return fn as unknown as Parameters<typeof searchVenues>[0] & typeof fn;
}

describe("searchVenues", () => {
  it("re-counts when a continuation page comes back empty (data changed between pages)", async () => {
    const sql = fakeSql((afterId) => (afterId === null ? [row] : []));
    const q = query("limit=1");
    q.cursor = encodeCursor({ distanceM: 3000, venueId: ID, returned: 1 }, canonicalSearchKey(q), SECRET);

    const body = await searchVenues(sql, q, SECRET);

    expect(body).toEqual({ items: [], totalCount: 7, nextCursor: null });
  });

  it.each([
    ["a venue remains", true],
    ["nothing remains", false],
  ])(
    "on a full page whose running count is stale (venues on earlier pages stopped matching), checks the next row: %s",
    async (_name, remains) => {
      // The client has seen 5 rows; the total has since shrunk to 3, but rows still follow.
      const NEXT = "5eed0000-0000-4000-8000-000000000002";
      const sql = fakeSql((afterId) => {
        if (afterId === ID) return [{ ...row, venue_id: NEXT, total_count: "3" }];
        return remains ? [{ ...row, venue_id: "5eed0000-0000-4000-8000-000000000003", total_count: "3" }] : [];
      });
      const q = query("limit=1");
      q.cursor = encodeCursor({ distanceM: 3000, venueId: ID, returned: 5 }, canonicalSearchKey(q), SECRET);

      const body = await searchVenues(sql, q, SECRET);

      expect(body.items.map((item) => item.id)).toEqual([NEXT]);
      expect(body.nextCursor !== null).toBe(remains);
    },
  );

  it("rejects a bad cursor before querying the database", async () => {
    const sql = fakeSql(() => [row]);
    const q = query("");
    q.cursor = encodeCursor(
      { distanceM: 3000, venueId: ID, returned: 1 },
      canonicalSearchKey(query("radiusKm=20")),
      SECRET,
    );

    await expect(searchVenues(sql, q, SECRET)).rejects.toThrow(ApiError);
    expect(sql).not.toHaveBeenCalled();
  });
});
