import type { Metadata } from "next";

import type { MediaDto } from "@/features/venues/dto";

// Per-page metadata (PR 4.2): title, description, a canonical URL and the matching Open Graph card.
// Paths are relative; the root layout's `metadataBase` (src/lib/site.ts) makes them absolute.
// Next replaces a parent's `openGraph` wholesale rather than merging it, so every page builds its
// card here in full.

export const SITE_NAME = "FieldFinder";

interface PageMetadataInput {
  title: string;
  description: string;
  /** Site path such as `/venues/x`, already encoded. */
  path: string;
  /** Published images only; the first becomes the share image. */
  images?: readonly MediaDto[];
}

export function pageMetadata({ title, description, path, images = [] }: PageMetadataInput): Metadata {
  const [image] = images;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "en_AU",
      type: "website",
      ...(image === undefined
        ? {}
        : { images: [{ url: image.url, width: image.width, height: image.height, alt: image.alt }] }),
    },
  };
}

/**
 * For a lookup that found nothing: no canonical, no card. Next marks every notFound() response
 * `noindex` itself (tests/e2e/seo.spec.ts checks it), so it isn't repeated here.
 */
export const NOT_FOUND_METADATA: Metadata = { title: `Not found · ${SITE_NAME}` };
