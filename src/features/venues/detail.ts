import "server-only";

import { toPitchDto, type PitchDto } from "@/features/pitches/dto";
import type { publicDb } from "@/lib/db/public";

import { pitchMedia, venueMedia } from "@/features/media/public";

import { toVenueDetailDto, type MediaDto, type VenueDetailDto } from "./dto";

// Venue and pitch detail lookups by slug (spec §5, PR 2.8), shared by the API routes and, later, the
// detail pages (3.10, 3.11). Everything is read through the published-only views as ff_public_reader,
// so a draft, an archived record, a venue with no published pitch and a pitch under an unpublished
// venue are all simply absent: callers turn null into a 404 without saying which case it was.

/** Published data only, so shared caches may keep it briefly (same policy as search). */
export const DETAIL_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export interface VenueDetailResponse {
  venue: VenueDetailDto;
  /** Published pitches only, ordered by name. Never empty: a venue without one isn't public. */
  pitches: PitchDto[];
  /** The venue's published images, in display order (PR 2.12). */
  media: MediaDto[];
}

export interface PitchDetailResponse {
  pitch: PitchDto;
  /** The pitch's venue: shared facilities, address and location are shown on the pitch page. */
  venue: VenueDetailDto;
  /** The pitch's own published images (PR 2.12). */
  media: MediaDto[];
  /** The venue's published images, for the pitch page's gallery and facilities. */
  venueMedia: MediaDto[];
}

/** A connection as ff_public_reader. */
type Sql = ReturnType<typeof publicDb>;

async function findVenue(sql: Sql, venueSlug: string): Promise<VenueDetailDto | null> {
  const [row] = await sql`select * from public.public_venues_v where slug = ${venueSlug}`;
  return row === undefined ? null : toVenueDetailDto(row);
}

export async function getVenueDetail(sql: Sql, venueSlug: string): Promise<VenueDetailResponse | null> {
  const venue = await findVenue(sql, venueSlug);
  if (venue === null) return null;

  const rows = await sql`select * from public.public_pitches_v where venue_id = ${venue.id}::uuid order by name, id`;
  return { venue, pitches: rows.map((row) => toPitchDto(row)), media: await venueMedia(sql, venue.id) };
}

export async function getPitchDetail(
  sql: Sql,
  venueSlug: string,
  pitchSlug: string,
): Promise<PitchDetailResponse | null> {
  const venue = await findVenue(sql, venueSlug);
  if (venue === null) return null;

  // A pitch slug is only unique within its venue.
  const [row] = await sql`
    select * from public.public_pitches_v where venue_id = ${venue.id}::uuid and slug = ${pitchSlug}
  `;
  if (row === undefined) return null;
  const pitch = toPitchDto(row);
  return { pitch, venue, media: await pitchMedia(sql, pitch.id), venueMedia: await venueMedia(sql, venue.id) };
}
