import { describe, expect, it } from "vitest";

import { mediaImagesConfig, OPTIMIZER_CACHE_SECONDS } from "./image-optimization";

describe("mediaImagesConfig (PR 3.12)", () => {
  it("allows only the public media bucket's path on its origin", () => {
    expect(mediaImagesConfig("https://abc.supabase.co/storage/v1/object/public/media-public/")?.remotePatterns).toEqual(
      [
        {
          protocol: "https",
          hostname: "abc.supabase.co",
          port: "",
          pathname: "/storage/v1/object/public/media-public/**",
          search: "",
        },
      ],
    );
  });

  it("keeps a local port and plain http (local Supabase)", () => {
    expect(mediaImagesConfig("http://127.0.0.1:54321/storage/v1/object/public/media-public")?.remotePatterns).toEqual([
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/media-public/**",
        search: "",
      },
    ]);
  });

  it("never caches a resized photo longer than a minute, and never allows SVG", () => {
    const config = mediaImagesConfig("https://abc.supabase.co/storage/v1/object/public/media-public");
    expect(config?.minimumCacheTTL).toBe(OPTIMIZER_CACHE_SECONDS);
    expect(OPTIMIZER_CACHE_SECONDS).toBeLessThanOrEqual(60);
    expect(config?.dangerouslyAllowSVG).toBe(false);
  });

  it("keeps Next's block on private addresses, except for a local Supabase bucket", () => {
    expect(
      mediaImagesConfig("https://abc.supabase.co/storage/v1/object/public/media-public")?.dangerouslyAllowLocalIP,
    ).toBe(false);
    for (const local of ["http://127.0.0.1:54321/x", "http://localhost:54321/x", "http://[::1]:54321/x"]) {
      expect(mediaImagesConfig(local)?.dangerouslyAllowLocalIP).toBe(true);
    }
    // A private-network host isn't "local Supabase": still blocked.
    expect(mediaImagesConfig("http://10.0.0.5/storage/v1/object/public/media-public")?.dangerouslyAllowLocalIP).toBe(
      false,
    );
  });

  it.each([undefined, "", "  ", "not a url", "javascript:alert(1)", "ftp://files.example/x"])(
    "is off (photos unoptimised) for %j",
    (value) => {
      expect(mediaImagesConfig(value)).toBeNull();
    },
  );
});
