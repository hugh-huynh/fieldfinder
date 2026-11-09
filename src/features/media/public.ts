import "server-only";

import { toMediaDto, type MediaDto } from "@/features/venues/dto";
import type { publicDb } from "@/lib/db/public";
import { mediaPublicBaseUrl } from "@/lib/env";

// Published images for public responses (PR 2.12). Read only from public_media_v, which returns
// media that is published, has a public key and belongs to a public venue or pitch (migration 0003),
// and mapped through the toMediaDto allowlist: never storage keys, evidence or rights internals.
// The public base URL is read only when there's an image to show.

type Sql = ReturnType<typeof publicDb>;

function urlFor(key: string): string {
  return `${mediaPublicBaseUrl()}/${key}`;
}

/** A venue's own images, in display order. */
export async function venueMedia(sql: Sql, venueId: string): Promise<MediaDto[]> {
  const rows = await sql`
    select * from public.public_media_v where venue_id = ${venueId}::uuid order by display_order, id
  `;
  return rows.map((row) => toMediaDto(row, urlFor));
}

/** A pitch's own images, in display order. */
export async function pitchMedia(sql: Sql, pitchId: string): Promise<MediaDto[]> {
  const rows = await sql`
    select * from public.public_media_v where pitch_id = ${pitchId}::uuid order by display_order, id
  `;
  return rows.map((row) => toMediaDto(row, urlFor));
}

/**
 * One thumbnail per venue for search results (spec §5 "approved image"): the venue's first image,
 * else the first image of one of its published pitches.
 */
export async function searchImages(sql: Sql, venueIds: string[]): Promise<Map<string, MediaDto>> {
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
  return new Map(rows.map((row) => [row.owner_venue, toMediaDto(row, urlFor)]));
}
