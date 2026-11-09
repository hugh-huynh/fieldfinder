import "server-only";

import { toMediaDto, type MediaDto } from "@/features/venues/dto";
import type { publicDb } from "@/lib/db/public";
import { mediaPublicBaseUrl } from "@/lib/env";
import { log as defaultLogger, type Logger } from "@/lib/log";

// Published images for public responses (PR 2.12). Read only from public_media_v, which returns
// media that is published, has a public key and belongs to a public venue or pitch (migration 0003),
// and mapped through the toMediaDto allowlist: never storage keys, evidence or rights internals.
//
// If MEDIA_PUBLIC_BASE_URL is missing or invalid, images are left out of the response and an error is
// logged, rather than the whole search or page failing: an images misconfiguration mustn't take down
// search. Leaving images out can't expose anything. (Admin media routes still fail loudly.)

type Sql = ReturnType<typeof publicDb>;

/** Maps rows to DTOs, or returns no images (and logs once) when the public base URL isn't usable. */
function toPublicMedia(rows: readonly Record<string, unknown>[], logger: Logger): MediaDto[] {
  if (rows.length === 0) return [];
  let base: string;
  try {
    base = mediaPublicBaseUrl();
  } catch (error) {
    // The message names the variable, never a value.
    logger.error("media.public_base_url_unavailable", { error, omittedImages: rows.length });
    return [];
  }
  return rows.map((row) => toMediaDto(row, (key) => `${base}/${key}`));
}

/** A venue's own images, in display order. */
export async function venueMedia(sql: Sql, venueId: string, logger: Logger = defaultLogger): Promise<MediaDto[]> {
  const rows = await sql`
    select * from public.public_media_v where venue_id = ${venueId}::uuid order by display_order, id
  `;
  return toPublicMedia(rows, logger);
}

/** A pitch's own images, in display order. */
export async function pitchMedia(sql: Sql, pitchId: string, logger: Logger = defaultLogger): Promise<MediaDto[]> {
  const rows = await sql`
    select * from public.public_media_v where pitch_id = ${pitchId}::uuid order by display_order, id
  `;
  return toPublicMedia(rows, logger);
}

/**
 * One thumbnail per venue for search results (spec §5 "approved image"): the venue's first image,
 * else the first image of one of its published pitches.
 */
export async function searchImages(
  sql: Sql,
  venueIds: string[],
  logger: Logger = defaultLogger,
): Promise<Map<string, MediaDto>> {
  if (venueIds.length === 0) return new Map();
  const rows = await sql<({ owner_venue: string } & Record<string, unknown>)[]>`
    select distinct on (owner_venue) *
    from (
      select m.*, m.venue_id as owner_venue, 0 as owner_rank
      from public.public_media_v m
      where m.venue_id = any(${venueIds}::uuid[])
      union all
      select m.*, p.venue_id as owner_venue, 1 as owner_rank
      from public.public_media_v m
      join public.public_pitches_v p on p.id = m.pitch_id
      where p.venue_id = any(${venueIds}::uuid[])
    ) candidates
    order by owner_venue, owner_rank, display_order, id
  `;
  const media = toPublicMedia(rows, logger);
  return new Map(media.map((dto, i) => [String(rows[i]?.owner_venue), dto]));
}
