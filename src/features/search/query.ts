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

// Query contract for GET /api/venues (spec §5, PR 2.7). Parsing is strict: unknown or repeated
// parameters are rejected. Equivalent spellings ("001", "-37.8136", reordered parameters) parse to
// the same SearchQuery, and the route redirects them to canonicalQueryString(), so scrapers can't
// vary the URL to dodge caches or limits. Coordinates are rounded here as well as in the client (ADR-0005).

export const DEFAULT_RADIUS_KM = 10; // C9
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 50;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 30;
/** Coordinates are rounded to 3 dp (~110 m): enough for a search centre, never a precise fix. */
export const COORDINATE_DECIMALS = 3;
const MAX_CURSOR_LENGTH = 512;

/** A search after validation and normalisation. Equal searches always produce equal objects. */
export interface SearchQuery {
  lat: number;
  lng: number;
  radiusKm: number;
  surface: Surface | null;
  pitchSize: PitchFormat | null;
  /** Filter on floodlights: true = "yes", false = "no", null = any. */
  lighting: boolean | null;
  access: AccessClass | null;
  /** Sorted in AMENITY_KEYS order, no duplicates. Empty = no amenity filter. */
  amenities: AmenityKey[];
  limit: number;
  cursor: string | null;
}

// Plain decimals only: no exponents, hex, whitespace, "Infinity" or leading "+".
const decimal = z.string().regex(/^-?\d{1,3}(\.\d{1,12})?$/);
const integer = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number);

function round(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  // `|| 0` turns -0 into 0 so the canonical form has one spelling.
  return Math.round(value * factor) / factor || 0;
}

const coordinate = (min: number, max: number) =>
  decimal
    .transform(Number)
    .refine((value) => value >= min && value <= max)
    .transform(round);

const schema = z
  .object({
    lat: coordinate(-90, 90),
    lng: coordinate(-180, 180),
    radiusKm: integer.pipe(z.number().int().min(MIN_RADIUS_KM).max(MAX_RADIUS_KM)).default(DEFAULT_RADIUS_KM),
    surface: z.enum(SURFACES).optional(),
    pitchSize: z.enum(PITCH_FORMATS).optional(),
    lighting: z.enum(["yes", "no"]).optional(),
    access: z.enum(ACCESS_CLASSES).optional(),
    // Comma-separated, e.g. "toilets,parking". Order and duplicates don't matter.
    amenities: z
      .string()
      .max(200)
      .transform((value) => value.split(","))
      .pipe(z.array(z.enum(AMENITY_KEYS)).min(1))
      .optional(),
    limit: integer.pipe(z.number().int().min(1).max(MAX_LIMIT)).default(DEFAULT_LIMIT),
    cursor: z
      .string()
      .min(1)
      .max(MAX_CURSOR_LENGTH)
      .regex(/^[A-Za-z0-9_.-]+$/)
      .optional(),
  })
  .strict();

export type QueryParseResult = { ok: true; query: SearchQuery } | { ok: false; fields: string[] };

/** Parses URL search params. On failure returns only the offending parameter names. */
export function parseSearchQuery(params: URLSearchParams): QueryParseResult {
  const raw: Record<string, string> = {};
  const repeated = new Set<string>();
  for (const [key, value] of params) {
    if (Object.hasOwn(raw, key)) repeated.add(key);
    raw[key] = value;
  }

  const result = schema.safeParse(raw);
  if (!result.success || repeated.size > 0) {
    const fields = new Set(repeated);
    for (const issue of result.success ? [] : result.error.issues) {
      if (issue.code === "unrecognized_keys") issue.keys.forEach((key) => fields.add(key));
      else fields.add(issue.path.map(String)[0] ?? "(request)");
    }
    return { ok: false, fields: [...fields] };
  }

  const q = result.data;
  const amenities = AMENITY_KEYS.filter((key) => q.amenities?.includes(key));
  return {
    ok: true,
    query: {
      lat: q.lat,
      lng: q.lng,
      radiusKm: q.radiusKm,
      surface: q.surface ?? null,
      pitchSize: q.pitchSize ?? null,
      lighting: q.lighting === undefined ? null : q.lighting === "yes",
      access: q.access ?? null,
      amenities,
      limit: q.limit,
      cursor: q.cursor ?? null,
    },
  };
}

/**
 * Stable text form of everything that decides WHICH venues match and in what order. A cursor is
 * bound to it, so a cursor can't be replayed with different filters. `limit` and `cursor` are
 * excluded: page size may change between pages without changing the result set.
 */
export function canonicalSearchKey(query: SearchQuery): string {
  return JSON.stringify([
    "v1",
    query.lat,
    query.lng,
    query.radiusKm,
    query.surface,
    query.pitchSize,
    query.lighting,
    query.access,
    query.amenities,
  ]);
}

/**
 * The one URL query string for `query`: fixed parameter order, defaults omitted, numbers in their
 * shortest form, amenities in AMENITY_KEYS order. Every value uses only URL-safe characters, so no
 * percent-encoding is needed. The route redirects any other spelling here, so equivalent searches
 * share one cache entry and can't be varied to force repeated database queries.
 */
export function canonicalQueryString(query: SearchQuery): string {
  const parts: [string, string | number | null][] = [
    ["lat", query.lat],
    ["lng", query.lng],
    ["radiusKm", query.radiusKm === DEFAULT_RADIUS_KM ? null : query.radiusKm],
    ["surface", query.surface],
    ["pitchSize", query.pitchSize],
    ["lighting", query.lighting === null ? null : query.lighting ? "yes" : "no"],
    ["access", query.access],
    ["amenities", query.amenities.length > 0 ? query.amenities.join(",") : null],
    ["limit", query.limit === DEFAULT_LIMIT ? null : query.limit],
    ["cursor", query.cursor],
  ];
  return parts
    .filter((part): part is [string, string | number] => part[1] !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}
