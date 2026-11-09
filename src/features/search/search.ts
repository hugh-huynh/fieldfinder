import "server-only";

import { z } from "zod";

import { searchImages } from "@/features/media/public";
import {
  toAmenitiesDto,
  toVenueSummaryDto,
  type AmenitiesDto,
  type MediaDto,
  type VenueSummaryDto,
} from "@/features/venues/dto";
import { ApiError } from "@/lib/api/errors";
import type { publicDb } from "@/lib/db/public";
import { dbNumber } from "@/lib/db/row-types";

import { decodeCursor, encodeCursor, type CursorPosition } from "./cursor";
import { canonicalSearchKey, type SearchQuery } from "./query";

// Takes a cleaned-up search (from query.ts), asks the database "which
// venues match, nearest first?", and packs the answer into a safe response. Results come one page at
// a time; each page ends with a signed bookmark (the cursor, see cursor.ts) the client sends back to
// get the next page.
//
// GET /api/venues logic (spec §5, PR 2.7). All filtering, the same-pitch predicate and keyset
// ordering live in search_venues() (migration 0003); this module validates the cursor, calls it as
// ff_public_reader, and maps rows through the DTO allowlists.

/**
 * Published data only, so shared caches may keep it briefly. Coordinates are rounded to 3 dp before
 * the query runs, but the cache key is the URL, so clients should round too (ADR-0005).
 */
export const SEARCH_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

/** The canonical form of a URL never changes within a deploy, so its redirect can be cached for long. */
export const CANONICAL_REDIRECT_CACHE_CONTROL = "public, max-age=0, s-maxage=86400";

export interface VenueSearchResultDto extends VenueSummaryDto {
  /** Confirmed venue amenities; a missing key means "not confirmed". */
  amenities: AmenitiesDto;
  /** The venue's first published image, else one of its published pitches' (PR 2.12); null if none. */
  image: MediaDto | null;
}

export interface VenueSearchResponse {
  items: VenueSearchResultDto[];
  /** Venues matching the search within the radius, across all pages (D8). */
  totalCount: number;
  /** Pass back as `cursor` for the next page; null when there are no more results. */
  nextCursor: string | null;
}

const searchRow = z.object({
  venue_id: z.uuid(),
  distance_m: dbNumber,
  total_count: dbNumber,
});

const amenityRow = z.object({ id: z.uuid(), amenities: z.record(z.string(), z.unknown()) });

/** A connection as ff_public_reader (the only role that can call search_venues()). */
type Sql = ReturnType<typeof publicDb>;
type SearchRow = Record<string, unknown>;

function callSearch(sql: Sql, query: SearchQuery, limit: number, after: CursorPosition | null) {
  // Named arguments keep the call readable and independent of parameter order. Casts pin the types:
  // with prepare:false postgres.js sends parameters as text, and the function has no overloads.
  return sql<SearchRow[]>`
    select *
    from public.search_venues(
      p_lat => ${query.lat}::double precision,
      p_lng => ${query.lng}::double precision,
      p_radius_m => ${query.radiusKm * 1000}::integer,
      p_surface => ${query.surface}::public.surface,
      p_pitch_format => ${query.pitchSize}::public.pitch_format,
      p_floodlights => ${query.lighting}::boolean,
      p_access => ${query.access}::public.access_class,
      p_amenities => ${query.amenities.length > 0 ? query.amenities : null}::public.amenity_key[],
      p_after_distance_m => ${after?.distanceM ?? null}::double precision,
      p_after_id => ${after?.venueId ?? null}::uuid,
      p_limit => ${limit}::integer
    )
  `;
}

export async function searchVenues(sql: Sql, query: SearchQuery, secret: string): Promise<VenueSearchResponse> {
  const searchKey = canonicalSearchKey(query);

  // Step 1: if the client sent a bookmark, check it's genuine and belongs to this search.
  let after: CursorPosition | null = null;
  if (query.cursor !== null) {
    after = decodeCursor(query.cursor, searchKey, secret);
    if (after === null) throw new ApiError("invalid_request", "Invalid request parameters: cursor");
  }

  // Step 2: ask the database for the next page of matches, starting just after the bookmark.
  const rows = await callSearch(sql, query, query.limit, after);
  const parsed = rows.map((row) => searchRow.parse(row));

  // total_count repeats on every row. A continuation page can only be empty if the data changed since
  // the previous page; then count again from the start of the search.
  let totalCount = parsed[0]?.total_count ?? 0;
  if (parsed.length === 0 && after !== null) {
    const [first] = await callSearch(sql, query, 1, null);
    totalCount = first === undefined ? 0 : searchRow.parse(first).total_count;
  }

  // Step 3: look up amenities (toilets, parking...) for this page's venues, then copy only the
  // public fields into the response.
  const ids = parsed.map((row) => row.venue_id);
  const amenityRows =
    ids.length === 0 ? [] : await sql`select id, amenities from public.public_venues_v where id = any(${ids}::uuid[])`;
  const amenitiesById = new Map(
    amenityRows.map((row) => {
      const r = amenityRow.parse(row);
      return [r.id, toAmenitiesDto(r.amenities)] as const;
    }),
  );

  const images = await searchImages(sql, ids);
  const items = rows.map((row) => {
    const summary = toVenueSummaryDto(row);
    return { ...summary, amenities: amenitiesById.get(summary.id) ?? {}, image: images.get(summary.id) ?? null };
  });

  // Step 4: if there might be more results, hand out a new bookmark pointing at this page's last venue.
  const returned = (after?.returned ?? 0) + parsed.length;
  const last = parsed.at(-1);
  let nextCursor: string | null = null;
  if (last !== undefined && parsed.length === query.limit) {
    const position = { distanceM: last.distance_m, venueId: last.venue_id, returned };
    // A short page is always the end. A full page is ambiguous: the running count settles the usual
    // case, but it can be stale if venues on earlier pages stopped matching since, so when the count
    // says "done" check for one more row instead of trusting it.
    const more = returned < totalCount || (await callSearch(sql, query, 1, position)).length > 0;
    if (more) nextCursor = encodeCursor(position, searchKey, secret);
  }

  return { items, totalCount, nextCursor };
}
