import { REVERSE_CACHE_CONTROL, reverseLocation, reverseQuerySchema } from "@/features/locations/reverse";
import { ApiError } from "@/lib/api/errors";
import { apiRoute, parseInput } from "@/lib/api/handler";

// GET /api/locations/reverse?lat=&lng= — the locality at a device's position, for "Use my location"
// (spec §3, ADR-0005, PR 3.9). The client sends coordinates rounded to 2 dp; they're rounded again
// before Mapbox and never logged. Never cached (Mapbox's terms for free "temporary" geocoding).
// Rate-limited at the edge by the /api/locations/ Firewall rule (ADR-0004).

export const GET = apiRoute("locations.reverse", async (request) => {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(raw, key)) {
      // Names only, sanitised; never the values (they're a position).
      const name = key.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "(request)";
      throw new ApiError("invalid_request", `Invalid request parameters: ${name}`);
    }
    raw[key] = value;
  }
  const { lat, lng } = parseInput(reverseQuerySchema, raw);
  const body = await reverseLocation(lat, lng);
  return Response.json(body, { headers: { "cache-control": REVERSE_CACHE_CONTROL } });
});
