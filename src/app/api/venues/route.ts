import { parseSearchQuery } from "@/features/search/query";
import { SEARCH_CACHE_CONTROL, searchVenues } from "@/features/search/search";
import { ApiError } from "@/lib/api/errors";
import { apiRoute } from "@/lib/api/handler";
import { publicDb } from "@/lib/db/public";
import { searchCursorSecret } from "@/lib/env";

// GET /api/venues — bounded public venue search (spec §5, PR 2.7).
// Query: lat, lng (required); radiusKm 1–50 (default 10); surface, pitchSize, lighting (yes|no),
// access, amenities (comma-separated); limit 1–30 (default 20); cursor (from the previous page).

export const GET = apiRoute("venues.search", async (request) => {
  const parsed = parseSearchQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    // Names only, sanitised and sorted; never the values (they can be coordinates).
    const fields = [...new Set(parsed.fields.map((field) => field.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40)))]
      .filter(Boolean)
      .sort()
      .slice(0, 10);
    throw new ApiError("invalid_request", `Invalid request parameters: ${fields.join(", ") || "(request)"}`);
  }

  const body = await searchVenues(publicDb(), parsed.query, searchCursorSecret());
  return Response.json(body, { headers: { "cache-control": SEARCH_CACHE_CONTROL } });
});
