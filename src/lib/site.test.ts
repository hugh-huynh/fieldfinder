import { describe, expect, it } from "vitest";

import { indexingAllowed, siteOrigin, siteUrl } from "./site";

describe("siteOrigin", () => {
  it("uses SITE_URL first, reduced to its origin", () => {
    expect(
      siteOrigin({
        SITE_URL: "https://fieldfinder.test/some/path?q=1",
        VERCEL_PROJECT_PRODUCTION_URL: "ff.vercel.app",
      }),
    ).toBe("https://fieldfinder.test");
  });

  it("falls back to Vercel's production domain, then localhost", () => {
    expect(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "ff-prod.vercel.app" })).toBe("https://ff-prod.vercel.app");
    expect(siteOrigin({ SITE_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "" })).toBe("http://localhost:3000");
    expect(siteOrigin({})).toBe("http://localhost:3000");
  });

  it("allows plain http only for localhost", () => {
    expect(siteOrigin({ SITE_URL: "http://localhost:3100" })).toBe("http://localhost:3100");
  });

  it.each(["http://fieldfinder.test", "ftp://fieldfinder.test", "not a url", "javascript:alert(1)"])(
    "refuses SITE_URL %j, naming the variable only",
    (value) => {
      expect(() => siteOrigin({ SITE_URL: value })).toThrow(new Error("SITE_URL must be an https:// URL"));
    },
  );
});

describe("siteUrl", () => {
  it("makes a site path absolute", () => {
    expect(siteUrl("/venues/test-reserve", { SITE_URL: "https://fieldfinder.test" })).toBe(
      "https://fieldfinder.test/venues/test-reserve",
    );
    expect(siteUrl("/", {})).toBe("http://localhost:3000/");
  });
});

describe("indexingAllowed", () => {
  it("is true on Vercel production only", () => {
    expect(indexingAllowed({ VERCEL_ENV: "production" })).toBe(true);
    expect(indexingAllowed({ VERCEL_ENV: "preview" })).toBe(false);
    expect(indexingAllowed({ VERCEL_ENV: "development" })).toBe(false);
    expect(indexingAllowed({ SITE_URL: "https://fieldfinder.test" })).toBe(false);
    expect(indexingAllowed({})).toBe(false);
  });
});
