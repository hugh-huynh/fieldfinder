import { z } from "zod";

import {
  ACCESS_CLASSES,
  AMENITY_KEYS,
  PITCH_FORMATS,
  SURFACES,
  type AccessClass,
  type AmenityKey,
  type PitchFormat,
  type Surface,
} from "@/lib/domain/enums";

import {
  canonicalQueryString,
  COORDINATE_DECIMALS,
  DEFAULT_LIMIT,
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
} from "./query";

// The search page's state and its URL (PR 3.1, spec §3 "URL encodes stable search parameters").
//
// The page URL (`/?lat=-37.814&lng=144.963&place=Brunswick+VIC&surface=grass`) is the source of
// truth for the APPLIED search: reload, share and back/forward restore it. Unlike the API parser in
// ./query.ts, which rejects anything odd with a 400, this parser never fails: a bad parameter falls
// back to its default and an unknown one (utm_source, fbclid…) is ignored, because a person who
// follows a mangled link should still get a working page.
//
// Coordinates (ADR-0005, plan T1): a typed place is a geocoder centroid, rounded to 3 dp (~110 m);
// a device fix is personal, so it is rounded to 2 dp (~1.1 km) before it enters state, the URL or
// any request. The precise fix never comes through here.
//
// Filters have a draft and an applied copy (spec §3 filters): the dialog edits the draft, and only
// "Show venues" applies it. Cancel, X and Escape discard it.

/** Decimal places for a device (geolocation) fix: ~1.1 km. */
export const DEVICE_COORDINATE_DECIMALS = 2;
/** Longest place label kept from the URL; longer ones are dropped, not truncated. */
export const MAX_PLACE_LABEL_LENGTH = 120;

export interface SearchLocation {
  lat: number;
  lng: number;
  /** What the search box shows, e.g. "Brunswick VIC 3056". Null when unknown. */
  label: string | null;
}

export interface SearchFilters {
  radiusKm: number;
  surface: Surface | null;
  pitchSize: PitchFormat | null;
  /** Floodlights: true = "yes", false = "no", null = any. */
  lighting: boolean | null;
  access: AccessClass | null;
  /** In AMENITY_KEYS order, no duplicates. Empty = any. */
  amenities: AmenityKey[];
}

export interface SearchState {
  /** Null until the person picks a place or shares their location. */
  location: SearchLocation | null;
  filters: SearchFilters;
}

/** No filters and the default radius. A new object each time, so callers can't share and mutate one. */
export function defaultFilters(): SearchFilters {
  return { radiusKm: DEFAULT_RADIUS_KM, surface: null, pitchSize: null, lighting: null, access: null, amenities: [] };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // `|| 0` turns -0 into 0, so a location has one spelling in the URL.
  return Math.round(value * factor) / factor || 0;
}

function validCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function cleanLabel(label: string | null | undefined): string | null {
  const trimmed = label?.trim().replace(/\s+/g, " ") ?? "";
  if (trimmed === "" || trimmed.length > MAX_PLACE_LABEL_LENGTH || /\p{Cc}/u.test(trimmed)) return null;
  return trimmed;
}

/** A location from a geocoder suggestion (not personal): 3 dp. Null if the coordinates are invalid. */
export function placeLocation(lat: number, lng: number, label: string | null): SearchLocation | null {
  if (!validCoordinates(lat, lng)) return null;
  return {
    lat: roundTo(lat, COORDINATE_DECIMALS),
    lng: roundTo(lng, COORDINATE_DECIMALS),
    label: cleanLabel(label),
  };
}

/** A location from the device's geolocation fix (personal): 2 dp. Null if the coordinates are invalid. */
export function deviceLocation(lat: number, lng: number, label: string | null): SearchLocation | null {
  if (!validCoordinates(lat, lng)) return null;
  return {
    lat: roundTo(lat, DEVICE_COORDINATE_DECIMALS),
    lng: roundTo(lng, DEVICE_COORDINATE_DECIMALS),
    label: cleanLabel(label),
  };
}

// --- URL → state ---------------------------------------------------------------------------------

// Plain decimals only (no exponents, hex, "Infinity"), as in the API.
const coordinate = (limit: number) =>
  z
    .string()
    .regex(/^-?\d{1,3}(\.\d{1,12})?$/)
    .transform(Number)
    .refine((value) => Math.abs(value) <= limit);

const pageParamsSchema = z.object({
  lat: coordinate(90).optional().catch(undefined),
  lng: coordinate(180).optional().catch(undefined),
  place: z.string().optional().catch(undefined),
  radiusKm: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(MIN_RADIUS_KM).max(MAX_RADIUS_KM))
    .catch(DEFAULT_RADIUS_KM),
  surface: z.enum(SURFACES).nullable().catch(null),
  pitchSize: z.enum(PITCH_FORMATS).nullable().catch(null),
  lighting: z.enum(["yes", "no"]).nullable().catch(null),
  access: z.enum(ACCESS_CLASSES).nullable().catch(null),
  // Unknown entries are dropped one by one, so "toilets,sauna" still filters on toilets.
  amenities: z
    .string()
    .max(200)
    .transform((value) => AMENITY_KEYS.filter((key) => value.split(",").includes(key)))
    .catch([]),
});

/** The search state in a page URL's query. Never throws; anything invalid becomes its default. */
export function parseSearchState(params: URLSearchParams): SearchState {
  // The first value wins when a parameter is repeated; everything but the known names is ignored.
  const raw: Record<string, string | null> = {};
  for (const key of Object.keys(pageParamsSchema.shape)) raw[key] = params.get(key);
  const p = pageParamsSchema.parse(raw);

  const location = p.lat === undefined || p.lng === undefined ? null : placeLocation(p.lat, p.lng, p.place ?? null);
  return {
    location,
    filters: {
      radiusKm: p.radiusKm,
      surface: p.surface,
      pitchSize: p.pitchSize,
      lighting: p.lighting === null ? null : p.lighting === "yes",
      access: p.access,
      amenities: p.amenities,
    },
  };
}

// --- state → URL ---------------------------------------------------------------------------------

/**
 * The page URL query for `state`, without the "?": fixed order, defaults omitted, so one search has
 * one URL. Empty when there is nothing to search yet and every filter is at its default.
 */
export function serializeSearchState(state: SearchState): string {
  const params = new URLSearchParams();
  const { location, filters } = state;
  if (location !== null) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
    if (location.label !== null) params.set("place", location.label);
  }
  if (filters.radiusKm !== DEFAULT_RADIUS_KM) params.set("radiusKm", String(filters.radiusKm));
  if (filters.surface !== null) params.set("surface", filters.surface);
  if (filters.pitchSize !== null) params.set("pitchSize", filters.pitchSize);
  if (filters.lighting !== null) params.set("lighting", filters.lighting ? "yes" : "no");
  if (filters.access !== null) params.set("access", filters.access);
  const amenities = AMENITY_KEYS.filter((key) => filters.amenities.includes(key));
  if (amenities.length > 0) params.set("amenities", amenities.join(","));
  // URLSearchParams encodes "," as %2C; it is safe in a query, and keeping it readable helps sharing.
  return params.toString().replaceAll("%2C", ",");
}

/**
 * The `GET /api/venues` query for `state`, in the API's canonical form (so it is never redirected),
 * or null when there is no location yet. The place label is never sent.
 */
export function apiQueryString(
  state: SearchState,
  page: { limit?: number; cursor?: string | null } = {},
): string | null {
  if (state.location === null) return null;
  const { filters } = state;
  return canonicalQueryString({
    lat: state.location.lat,
    lng: state.location.lng,
    radiusKm: filters.radiusKm,
    surface: filters.surface,
    pitchSize: filters.pitchSize,
    lighting: filters.lighting,
    access: filters.access,
    amenities: AMENITY_KEYS.filter((key) => filters.amenities.includes(key)),
    limit: page.limit ?? DEFAULT_LIMIT,
    cursor: page.cursor ?? null,
  });
}

// --- Draft vs applied filters --------------------------------------------------------------------

export interface FilterDialogState {
  /** The filters the results show (from the URL). */
  applied: SearchFilters;
  /** The dialog's working copy while it is open; null when closed. */
  draft: SearchFilters | null;
}

type ChoiceFilters = Pick<SearchFilters, "surface" | "pitchSize" | "lighting" | "access">;
/** One choice group's new value, e.g. `{ field: "surface", value: "grass" }`; null = any. */
type SetChoice = {
  [K in keyof ChoiceFilters]: { type: "setChoice"; field: K; value: ChoiceFilters[K] };
}[keyof ChoiceFilters];

export type FilterAction =
  | { type: "open" }
  | { type: "setRadius"; radiusKm: number }
  | SetChoice
  | { type: "toggleAmenity"; amenity: AmenityKey }
  /** "Clear all": the draft goes back to the defaults; the results don't change. */
  | { type: "clearAll" }
  /** Cancel, X or Escape: the draft is discarded. */
  | { type: "cancel" }
  /** "Show venues": the draft becomes the applied filters. The caller then updates the URL. */
  | { type: "apply" }
  /** The URL changed (back/forward, a shared link): adopt its filters and close the dialog. */
  | { type: "syncFromUrl"; filters: SearchFilters };

function clampRadius(radiusKm: number): number {
  if (!Number.isFinite(radiusKm)) return DEFAULT_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Math.round(radiusKm)));
}

function copy(filters: SearchFilters): SearchFilters {
  return { ...filters, amenities: [...filters.amenities] };
}

export function initialFilterDialogState(applied: SearchFilters): FilterDialogState {
  return { applied: copy(applied), draft: null };
}

/** Pure; returns `state` itself when an action doesn't apply (e.g. an edit while closed). */
export function filterDialogReducer(state: FilterDialogState, action: FilterAction): FilterDialogState {
  switch (action.type) {
    case "open":
      return state.draft === null ? { ...state, draft: copy(state.applied) } : state;
    case "syncFromUrl":
      return { applied: copy(action.filters), draft: null };
    case "cancel":
      return state.draft === null ? state : { ...state, draft: null };
    case "apply":
      return state.draft === null ? state : { applied: state.draft, draft: null };
    default:
      break;
  }

  const draft = state.draft;
  if (draft === null) return state;
  switch (action.type) {
    case "setRadius":
      return { ...state, draft: { ...draft, radiusKm: clampRadius(action.radiusKm) } };
    case "setChoice":
      return { ...state, draft: { ...draft, [action.field]: action.value } };
    case "toggleAmenity": {
      const on = draft.amenities.includes(action.amenity);
      const amenities = AMENITY_KEYS.filter((key) => (key === action.amenity ? !on : draft.amenities.includes(key)));
      return { ...state, draft: { ...draft, amenities } };
    }
    case "clearAll":
      return { ...state, draft: defaultFilters() };
  }
}
