import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { mapboxGeocodingToken } from "@/lib/env";
import { log as defaultLogger, type Logger } from "@/lib/log";

import { DEVICE_DECIMALS, type ReverseResponse } from "./query";

export { reverseQuerySchema, type ReversePlaceDto, type ReverseResponse } from "./query";

// The locality at a device's position, for "Use my location" (spec §3, ADR-0005, PR 3.9): a bounded
// proxy to Mapbox Geocoding v6 reverse lookup, Australia only, one locality.
//
// - Only rounded coordinates leave the server: they're rounded to 2 dp (~1.1 km) again here, whatever
//   the client sent, and never logged.
// - Same terms and limits as suggest (./suggest.ts): free "temporary" geocoding, so `no-store`; the
//   /api/locations/ Firewall rule (30/min/IP, ADR-0004) bounds cost. The token stays server-side and
//   errors carry an HTTP status, never the upstream URL.

const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/reverse";
/** A suburb or town reads best in the search box; postcodes and streets don't. */
const TYPES = "locality,place";
const TIMEOUT_MS = 3000;

export const REVERSE_CACHE_CONTROL = "no-store";

const feature = z.object({
  properties: z.object({
    feature_type: z.enum(["locality", "place"]),
    name: z.string().min(1).max(300),
    full_address: z.string().max(500).optional(),
    place_formatted: z.string().max(500).optional(),
  }),
});
const upstreamResponse = z.object({ features: z.array(z.unknown()).max(50) });

const rounded = (value: number) =>
  (Math.round(value * 10 ** DEVICE_DECIMALS) / 10 ** DEVICE_DECIMALS || 0).toFixed(DEVICE_DECIMALS);

const unavailable = () => new ApiError("unavailable", "Location lookup isn't available right now. Please try again.");

export async function reverseLocation(
  lat: number,
  lng: number,
  deps: { fetch?: typeof fetch; logger?: Logger } = {},
): Promise<ReverseResponse> {
  const logger = deps.logger ?? defaultLogger;
  let token: string;
  try {
    token = mapboxGeocodingToken();
  } catch (error) {
    logger.error("locations.reverse_unconfigured", { error });
    throw unavailable();
  }

  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    latitude: rounded(lat),
    longitude: rounded(lng),
    country: "au",
    types: TYPES,
    language: "en",
    access_token: token,
  }).toString();

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // Only the error's name: a fetch error's message or cause could echo the URL (token, position).
    logger.warn("locations.reverse_upstream_failed", { reason: error instanceof Error ? error.name : "unknown" });
    throw unavailable();
  }
  if (!response.ok) {
    await response.body?.cancel();
    const level = response.status === 401 || response.status === 403 ? "error" : "warn";
    logger[level]("locations.reverse_upstream_failed", { upstreamStatus: response.status });
    throw unavailable();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    logger.warn("locations.reverse_upstream_failed", { reason: "invalid JSON" });
    throw unavailable();
  }
  const parsed = upstreamResponse.safeParse(body);
  if (!parsed.success) {
    logger.warn("locations.reverse_upstream_failed", { reason: "unexpected shape" });
    throw unavailable();
  }

  // The first locality (or town) Mapbox gives; anything odd is skipped.
  for (const item of parsed.data.features) {
    const f = feature.safeParse(item);
    if (!f.success) continue;
    const p = f.data.properties;
    return {
      place: {
        name: p.name,
        label: p.full_address ?? (p.place_formatted === undefined ? p.name : `${p.name}, ${p.place_formatted}`),
      },
    };
  }
  return { place: null };
}
