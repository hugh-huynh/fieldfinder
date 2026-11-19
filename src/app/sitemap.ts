import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { sitemapEntries } from "@/features/seo/sitemap";
import { publicDb } from "@/lib/db/public";
import { siteUrl } from "@/lib/site";

// /sitemap.xml (PR 4.2, D9): published venues and pitches. Built per request, never at deploy time:
// a sitemap baked into the build would keep listing a venue after it's unpublished (spec §4), and the
// build has no database. `connection()` is what makes it request-time.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  return sitemapEntries(publicDb(), (path) => siteUrl(path));
}
