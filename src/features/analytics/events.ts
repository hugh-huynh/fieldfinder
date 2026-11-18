import { z } from "zod";

import { MAX_RADIUS_KM, MIN_RADIUS_KM } from "@/features/search/query";
import type { SearchFilters, SearchLocation } from "@/features/search/state";

// The GA4 events FieldFinder sends (spec §7, PR 4.1): typed names and parameters, snake_case. Every
// parameter is from the allowlist in §7: filter types, result counts, radius, public venue/pitch ids,
// the interaction source and the kind of search. Never a coordinate, a typed place or address, a
// name, an email or a token: each schema is strict, so an unexpected parameter is rejected rather
// than sent, and guard.ts checks every key and value again before anything leaves the page.
//
// `click_booking_link` is listed in §7 only for when external booking links exist; they don't.

/** Where a venue or pitch page was opened from: a results card, the map's preview, or anywhere else. */
export const INTERACTION_SOURCES = ["list", "map", "direct"] as const;
export type InteractionSource = (typeof INTERACTION_SOURCES)[number];

/** A search for a chosen or typed place, the device's location, or the map's "Search this area". */
export const SEARCH_TYPES = ["place", "nearby", "area"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Filter names as they appear in `filter_types`, e.g. "surface,lighting". */
export const FILTER_TYPES = ["radius", "surface", "pitch_size", "lighting", "access", "amenities"] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

const count = z.number().int().min(0).max(100_000);
const radiusKm = z.number().int().min(MIN_RADIUS_KM).max(MAX_RADIUS_KM);
/** Comma-separated FILTER_TYPES in a fixed order, or "none". */
const filterTypes = z
  .string()
  .max(80)
  .regex(new RegExp(`^(none|(${FILTER_TYPES.join("|")})(,(${FILTER_TYPES.join("|")}))*)$`));

const searchParams = z.strictObject({
  result_count: count,
  radius_km: radiusKm,
  filter_count: count,
  filter_types: filterTypes,
});

export const EVENT_SCHEMAS = {
  search_fields: searchParams.extend({ search_type: z.enum(["place", "area"]) }),
  nearby_search: searchParams,
  filter_fields: z.strictObject({ radius_km: radiusKm, filter_count: count, filter_types: filterTypes }),
  no_search_results: z.strictObject({
    search_type: z.enum(SEARCH_TYPES),
    radius_km: radiusKm,
    filter_count: count,
    filter_types: filterTypes,
  }),
  view_venue: z.strictObject({ venue_id: z.uuid(), source: z.enum(INTERACTION_SOURCES) }),
  view_pitch: z.strictObject({ venue_id: z.uuid(), pitch_id: z.uuid(), source: z.enum(INTERACTION_SOURCES) }),
  select_map_marker: z.strictObject({ venue_id: z.uuid(), source: z.literal("map") }),
  click_directions: z.strictObject({ venue_id: z.uuid(), pitch_id: z.uuid().optional() }),
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export type EventParams<N extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[N]>;
/** One event, name and parameters together, so a call can't pair a name with another's parameters. */
export type AnalyticsEvent = { [N in EventName]: { name: N; params: EventParams<N> } }[EventName];

export function isEventName(value: string): value is EventName {
  return Object.hasOwn(EVENT_SCHEMAS, value);
}

/** The event's parameters if they match its schema exactly, otherwise null (and nothing is sent). */
export function parseEvent(name: string, params: unknown): AnalyticsEvent | null {
  if (!isEventName(name)) return null;
  const parsed = EVENT_SCHEMAS[name].safeParse(params);
  return parsed.success ? ({ name, params: parsed.data } as AnalyticsEvent) : null;
}

// --- From search state ----------------------------------------------------------------------------

/** The filters that differ from their defaults, as FILTER_TYPES in order. */
export function activeFilterTypes(filters: SearchFilters, defaultRadiusKm: number): FilterType[] {
  const active: FilterType[] = [];
  if (filters.radiusKm !== defaultRadiusKm) active.push("radius");
  if (filters.surface !== null) active.push("surface");
  if (filters.pitchSize !== null) active.push("pitch_size");
  if (filters.lighting !== null) active.push("lighting");
  if (filters.access !== null) active.push("access");
  if (filters.amenities.length > 0) active.push("amenities");
  return active;
}

/** The parameters every search event shares: radius and which filters are on (never their place). */
export function filterParams(filters: SearchFilters, defaultRadiusKm: number) {
  const active = activeFilterTypes(filters, defaultRadiusKm);
  return {
    radius_km: filters.radiusKm,
    filter_count: active.length,
    filter_types: active.length === 0 ? "none" : active.join(","),
  };
}

/** Which kind of search a location is: the device's own (near me), "Search this area", or a place. */
export function searchType(location: SearchLocation, nearMe: boolean): SearchType {
  if (nearMe) return "nearby";
  return location.label === null ? "area" : "place";
}
