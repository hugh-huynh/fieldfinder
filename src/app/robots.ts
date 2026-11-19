import type { MetadataRoute } from "next";

import { indexingAllowed, siteUrl } from "@/lib/site";

// /robots.txt (PR 4.2). Production: crawl the pages, not the JSON API, and here's the sitemap.
// Anywhere else (previews, staging, local): crawl nothing. Advisory only (spec §6): rate limits and
// edge rules (4.3) are the controls; nothing private is reachable whatever a crawler does.

export default function robots(): MetadataRoute.Robots {
  if (!indexingAllowed()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: siteUrl("/sitemap.xml"),
  };
}
