import { SUGGEST_CACHE_CONTROL, suggestLocations, suggestQuerySchema } from "@/features/locations/suggest";
import { ApiError } from "@/lib/api/errors";
import { apiRoute, parseInput } from "@/lib/api/handler";

// GET /api/locations/suggest?q= — up to 5 Australian place/address suggestions with coordinates
// (spec §5, D6, PR 2.13). q is 2–80 characters. Never cached (Mapbox's terms for free "temporary"
// geocoding). Rate-limited at the edge by the /api/locations/ Firewall rule (ADR-0004).

export const GET = apiRoute("locations.suggest", async (request) => {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(raw, key)) {
      // Names only, sanitised; never the values (they're what the user typed).
      const name = key.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "(request)";
      throw new ApiError("invalid_request", `Invalid request parameters: ${name}`);
    }
    raw[key] = value;
  }
  const { q } = parseInput(suggestQuerySchema, raw);
  const body = await suggestLocations(q);
  return Response.json(body, { headers: { "cache-control": SUGGEST_CACHE_CONTROL } });
});
