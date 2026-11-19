import "server-only";

import type { MetadataRoute } from "next";
import { z } from "zod";

import { pitchPath, venuePath } from "@/features/venues/route-target";
import type { publicDb } from "@/lib/db/public";
import { dbTimestamp } from "@/lib/db/row-types";

// The sitemap's entries (PR 4.2, D9): the search page, the legal pages, and every published venue
// and pitch. Read only through the published-only views as ff_public_reader (ADR-0002), so a draft,
// an archived record, a venue without a published pitch and a pitch under an unpublished venue can't
// be listed: the views don't return them. Slugs and update times only, nothing else from the rows.

type Sql = ReturnType<typeof publicDb>;

const venueRow = z.object({ slug: z.string().min(1), updated_at: dbTimestamp });
const pitchRow = z.object({ venue_slug: z.string().min(1), slug: z.string().min(1), updated_at: dbTimestamp });

/** Pages that exist whatever the data; `lastModified` is left to crawlers for these. */
const STATIC_PATHS = ["/", "/privacy", "/terms"] as const;

export async function sitemapEntries(sql: Sql, absolute: (path: string) => string): Promise<MetadataRoute.Sitemap> {
  const [venues, pitches] = await Promise.all([
    sql`select slug, updated_at from public.public_venues_v order by slug`,
    sql`select venue_slug, slug, updated_at from public.public_pitches_v order by venue_slug, slug`,
  ]);
  return [
    ...STATIC_PATHS.map((path) => ({ url: absolute(path) })),
    ...venues.map((row) => {
      const r = venueRow.parse(row);
      return { url: absolute(venuePath(r.slug)), lastModified: r.updated_at };
    }),
    ...pitches.map((row) => {
      const r = pitchRow.parse(row);
      return { url: absolute(pitchPath(r.venue_slug, r.slug)), lastModified: r.updated_at };
    }),
  ];
}
