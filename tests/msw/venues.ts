import { delay, http, HttpResponse } from "msw";

import type { VenueSearchResponse, VenueSearchResultDto } from "@/features/search/search";

// Synthetic search results for component tests (PR 3.3). Invented names; not real venue data.

export function venueResult(n: number, overrides: Partial<VenueSearchResultDto> = {}): VenueSearchResultDto {
  return {
    id: `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `test-venue-${String(n)}`,
    name: `Test Venue ${String(n)}`,
    suburb: "Testville",
    state: "VIC",
    location: { latitude: -37.8, longitude: 144.96 },
    access: "public",
    distanceMeters: 1000 * n,
    publishedPitchCount: 2,
    matchingPitchCount: 2,
    href: `/venues/test-venue-${String(n)}`,
    amenities: {},
    image: null,
    pitchSummary: { surfaces: [], formats: [], floodlights: null },
    ...overrides,
  };
}

/**
 * Serves `pages` in order by cursor: page i is returned for cursor `c${i}` (page 0 without one).
 * Records each request's query string in `asked`.
 */
export function searchHandler(
  pages: VenueSearchResponse[],
  options: { asked?: string[]; wait?: number; status?: number } = {},
) {
  return http.get("*/api/venues", async ({ request }) => {
    const url = new URL(request.url);
    options.asked?.push(url.search.slice(1));
    if (options.wait !== undefined) await delay(options.wait);
    if (options.status !== undefined) {
      return HttpResponse.json({ code: "internal", message: "x", requestId: "r" }, { status: options.status });
    }
    const cursor = url.searchParams.get("cursor");
    const page = pages[cursor === null ? 0 : Number(cursor.slice(1))];
    return page === undefined ? HttpResponse.json({}, { status: 400 }) : HttpResponse.json(page);
  });
}
