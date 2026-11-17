import type { NextConfig } from "next";

// Responsive photos (PR 3.12; Hugh chose Vercel's image optimisation). Next.js resizes the media
// bucket's public WebPs to the sizes each device needs (srcset) and serves AVIF/WebP. Read by
// next.config.ts at build time, so plain TS with no server-only imports.
//
// - Only the public media bucket's path on its origin is allowed (MEDIA_PUBLIC_BASE_URL): the
//   optimiser can't be used to fetch or resize anything else.
// - Cached for at most 60 s by the optimiser itself (Next 16's default is 4 hours): an unpublished
//   photo is removed from the public bucket (ADR-0006), and the optimiser mustn't keep serving it
//   longer than the bucket's own caching would.
// - With no media URL configured (tests, CI builds), photos are served as stored (unoptimised).
// - Next refuses to fetch from private or loopback addresses (SSRF protection). That stays on
//   everywhere except a LOCAL Supabase bucket (127.0.0.1 / localhost / ::1, i.e. `pnpm db:start`),
//   so local runs and E2E use the same optimised path as production. Even then, remotePatterns
//   limits the optimiser to the bucket's path on that one host.

type ImagesConfig = NonNullable<NextConfig["images"]>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const OPTIMIZER_CACHE_SECONDS = 60;

/** The `images` config for the media bucket at `baseUrl`, or null when there isn't a usable one. */
export function mediaImagesConfig(baseUrl: string | undefined): ImagesConfig | null {
  const trimmed = baseUrl?.trim() ?? "";
  if (!/^https?:\/\//.test(trimmed) || !URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, "");
  return {
    remotePatterns: [
      {
        protocol: url.protocol === "https:" ? "https" : "http",
        hostname: url.hostname,
        port: url.port,
        pathname: `${path}/**`,
        search: "",
      },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: OPTIMIZER_CACHE_SECONDS,
    dangerouslyAllowSVG: false,
    dangerouslyAllowLocalIP: LOOPBACK_HOSTS.has(url.hostname),
  };
}
