import "server-only";

import { toPitchDto, type PitchDto } from "@/features/pitches/dto";
import type { publicDb } from "@/lib/db/public";

import { toVenueDetailDto, type VenueDetailDto } from "./dto";
import type { Identifier } from "./identifier";

// Venue and pitch detail lookups (spec §5, PR 2.8), shared by the API routes and, later, the detail
// pages (3.10, 3.11). Everything is read through the published-only views as ff_public_reader, so a
// draft, an archived record, a venue with no published pitch and a pitch under an unpublished venue
// are all simply absent: callers turn null into a 404 without saying which case it was.

/** Published data only, so shared caches may keep it briefly (same policy as search). */
export const DETAIL_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export interface VenueDetailResponse {
  venue: VenueDetailDto;
  /** Published pitches only, ordered by name. Never empty: a venue without one isn't public. */
  pitches: PitchDto[];
}

export interface PitchDetailResponse {
  pitch: PitchDto;
  /** The pitch's venue: shared facilities, address and location are shown on the pitch page. */
  venue: VenueDetailDto;
}

/** A connection as ff_public_reader. */
type Sql = ReturnType<typeof publicDb>;

async function findVenue(sql: Sql, venue: Identifier): Promise<VenueDetailDto | null> {
  const match = venue.kind === "id" ? sql`id = ${venue.id}::uuid` : sql`slug = ${venue.slug}`;
  const [row] = await sql`select * from public.public_venues_v where ${match}`;
  return row === undefined ? null : toVenueDetailDto(row);
}

export async function getVenueDetail(sql: Sql, venue: Identifier): Promise<VenueDetailResponse | null> {
  const found = await findVenue(sql, venue);
  if (found === null) return null;

  const rows = await sql`select * from public.public_pitches_v where venue_id = ${found.id}::uuid order by name, id`;
  return { venue: found, pitches: rows.map((row) => toPitchDto(row)) };
}

export async function getPitchDetail(
  sql: Sql,
  venue: Identifier,
  pitch: Identifier,
): Promise<PitchDetailResponse | null> {
  const found = await findVenue(sql, venue);
  if (found === null) return null;

  // Scoped to the venue: a pitch slug is only unique within its venue, and a pitch id from another
  // venue must not resolve under this one.
  const match = pitch.kind === "id" ? sql`id = ${pitch.id}::uuid` : sql`slug = ${pitch.slug}`;
  const [row] = await sql`select * from public.public_pitches_v where venue_id = ${found.id}::uuid and ${match}`;
  return row === undefined ? null : { pitch: toPitchDto(row), venue: found };
}
