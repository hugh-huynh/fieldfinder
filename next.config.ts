import type { NextConfig } from "next";

import { mediaImagesConfig } from "./src/lib/media/image-optimization";
import { buildSecurityHeaders } from "./src/lib/security/headers";

// Photos are resized by Next.js only for the public media bucket (PR 3.12). Without a bucket URL at
// build time, they're served as stored; NEXT_PUBLIC_MEDIA_OPTIMIZED tells the image component which.
const images = mediaImagesConfig(process.env.MEDIA_PUBLIC_BASE_URL);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(images === null ? {} : { images }),
  env: { NEXT_PUBLIC_MEDIA_OPTIMIZED: images === null ? "" : "1" },
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: buildSecurityHeaders() }]);
  },
};

export default nextConfig;
