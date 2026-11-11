import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { mapboxGeocodingToken } from "@/lib/env";
import { log as defaultLogger, type Logger } from "@/lib/log";

// Location suggestions for the search box (spec §5, D6, PR 2.13): a bounded proxy to Mapbox Geocoding
// v6 forward search, Australia only, biased towards Melbourne.
//
// Mapbox terms (checked 2026-11-09): free "temporary" results may not be cached, so responses are
// `no-store` everywhere (Hugh: temporary, no cache). Cost is bounded by q 2–80 characters, at most 5
// results, the Vercel Firewall rule on /api/locations/ (30/min/IP, ADR-0004) and client debouncing (M3).
// The token stays server-side and is never logged: errors carry an HTTP status, never the upstream URL.

const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/forward";
/** Melbourne CBD (lng, lat): FieldFinder is Melbourne-first, so nearby places rank higher. */
const PROXIMITY = "144.963,-37.814";
const TYPES = "postcode,place,locality,neighborhood,address";
const LIMIT = 5;
const TIMEOUT_MS = 3000;
/** Same 3 dp as search (ADR-0005): enough for a search centre. */
const COORDINATE_DECIMALS = 3;

export const SUGGEST_CACHE_CONTROL = "no-store";

/** Letters (any script), digits, spaces and the punctuation real place names and addresses use. */
const QUERY = /^[\p{L}\p{M}\p{N} ,.'’\-/&#()]+$/u;

export const suggestQuerySchema = z
  .object({
    q: z
      .string()
      .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
      .pipe(z.string().min(2).max(80).regex(QUERY)),
  })
  .strict();

export interface LocationSuggestionDto {
  /** Mapbox's id for the place. */
  id: string;
  /** Short name, e.g. "Brunswick". */
  name: string;
  /** Full label for the list, e.g. "Brunswick, Victoria 3056, Australia". */
  label: string;
  type: "postcode" | "place" | "locality" | "neighborhood" | "address";
  /** Rounded to 3 dp; pass straight to GET /api/venues. */
  latitude: number;
  longitude: number;
}

export interface SuggestResponse {
  suggestions: LocationSuggestionDto[];
}

const feature = z.object({
  properties: z.object({
    mapbox_id: z.string().min(1).max(200),
    feature_type: z.enum(["postcode", "place", "locality", "neighborhood", "address"]),
    name: z.string().min(1).max(300),
    full_address: z.string().max(500).optional(),
    place_formatted: z.string().max(500).optional(),
    coordinates: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  }),
});
const upstreamResponse = z.object({ features: z.array(z.unknown()).max(50) });

const round = (value: number) => Math.round(value * 10 ** COORDINATE_DECIMALS) / 10 ** COORDINATE_DECIMALS || 0;

const unavailable = () => new ApiError("unavailable", "Location search isn't available right now. Please try again.");

export async function suggestLocations(
  q: string,
  deps: { fetch?: typeof fetch; logger?: Logger } = {},
): Promise<SuggestResponse> {
  const logger = deps.logger ?? defaultLogger;
  let token: string;
  try {
    token = mapboxGeocodingToken();
  } catch (error) {
    logger.error("locations.suggest_unconfigured", { error });
    throw unavailable();
  }

  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    q,
    country: "au",
    proximity: PROXIMITY,
    types: TYPES,
    autocomplete: "true",
    limit: String(LIMIT),
    language: "en",
    access_token: token,
  }).toString();

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // Only the error's name: a fetch error's message or cause could echo the URL, which has the token.
    logger.warn("locations.suggest_upstream_failed", { reason: error instanceof Error ? error.name : "unknown" });
    throw unavailable();
  }
  if (!response.ok) {
    await response.body?.cancel();
    const level = response.status === 401 || response.status === 403 ? "error" : "warn";
    logger[level]("locations.suggest_upstream_failed", { upstreamStatus: response.status });
    throw unavailable();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    logger.warn("locations.suggest_upstream_failed", { reason: "invalid JSON" });
    throw unavailable();
  }
  const parsed = upstreamResponse.safeParse(body);
  if (!parsed.success) {
    logger.warn("locations.suggest_upstream_failed", { reason: "unexpected shape" });
    throw unavailable();
  }

  // Each feature is validated on its own; one odd result doesn't hide the others.
  const suggestions: LocationSuggestionDto[] = [];
  for (const item of parsed.data.features) {
    const f = feature.safeParse(item);
    if (!f.success) continue;
    const p = f.data.properties;
    suggestions.push({
      id: p.mapbox_id,
      name: p.name,
      label: p.full_address ?? (p.place_formatted === undefined ? p.name : `${p.name}, ${p.place_formatted}`),
      type: p.feature_type,
      latitude: round(p.coordinates.latitude),
      longitude: round(p.coordinates.longitude),
    });
    if (suggestions.length === LIMIT) break;
  }
  return { suggestions };
}
