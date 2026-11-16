import { delay, http, HttpResponse } from "msw";

import type { LocationSuggestionDto } from "@/features/locations/query";

// Synthetic place suggestions for the search box tests (PR 3.2). Not real Mapbox data.

export const PLACES: LocationSuggestionDto[] = [
  {
    id: "test.brunswick",
    name: "Brunswick",
    label: "Brunswick, Victoria 3056, Australia",
    type: "locality",
    latitude: -37.767,
    longitude: 144.962,
  },
  {
    id: "test.brunswick-east",
    name: "Brunswick East",
    label: "Brunswick East, Victoria 3057, Australia",
    type: "locality",
    latitude: -37.772,
    longitude: 144.979,
  },
  {
    id: "test.brunswick-west",
    name: "Brunswick West",
    label: "Brunswick West, Victoria 3055, Australia",
    type: "locality",
    latitude: -37.764,
    longitude: 144.944,
  },
];

/** Answers every query with the places whose name starts with it, and records each q asked. */
export function suggestHandler(options: { asked?: string[]; wait?: number; status?: number } = {}) {
  return http.get("*/api/locations/suggest", async ({ request }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    options.asked?.push(q);
    if (options.wait !== undefined) await delay(options.wait);
    if (options.status !== undefined) {
      return HttpResponse.json(
        { code: "upstream_unavailable", message: "x", requestId: "r" },
        { status: options.status },
      );
    }
    const suggestions = PLACES.filter((p) => p.name.toLowerCase().startsWith(q.toLowerCase()));
    return HttpResponse.json({ suggestions });
  });
}
