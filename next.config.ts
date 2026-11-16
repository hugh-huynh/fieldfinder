import type { NextConfig } from "next";
import { assertPublicMapboxToken } from "./src/features/map/token";
import { buildSecurityHeaders } from "./src/lib/security/headers";

// A secret Mapbox token must fail the build, not just hide the map: NEXT_PUBLIC_ values are inlined
// into browser JavaScript.
assertPublicMapboxToken(process.env.NEXT_PUBLIC_MAPBOX_TOKEN);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: buildSecurityHeaders() }]);
  },
};

export default nextConfig;
