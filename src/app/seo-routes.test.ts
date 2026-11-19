import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "./robots";
import sitemap from "./sitemap";

// /robots.txt and /sitemap.xml (PR 4.2) with the database mocked; the real published-only query runs
// in tests/integration/sitemap.test.ts. Synthetic data.

vi.mock("next/server", () => ({ connection: vi.fn(() => Promise.resolve()) }));

const db = vi.hoisted(() => ({ calls: [] as string[], venues: [] as unknown[], pitches: [] as unknown[] }));
vi.mock("@/lib/db/public", () => ({
  publicDb: () => (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    db.calls.push(text);
    return Promise.resolve(text.includes("public_venues_v") ? db.venues : db.pitches);
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  db.calls = [];
});

describe("robots", () => {
  it("lets crawlers in on production only, and points them at the sitemap", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SITE_URL", "https://fieldfinder.test");
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: "https://fieldfinder.test/sitemap.xml",
    });
  });

  it.each(["preview", "development", ""])("keeps every crawler out when VERCEL_ENV is %j", (env) => {
    vi.stubEnv("VERCEL_ENV", env);
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("sitemap", () => {
  it("lists the fixed pages, then published venues and pitches with their update times", async () => {
    vi.stubEnv("SITE_URL", "https://fieldfinder.test");
    db.venues = [{ slug: "test-reserve", updated_at: new Date("2026-11-01T00:00:00Z") }];
    db.pitches = [{ venue_slug: "test-reserve", slug: "east-pitch", updated_at: "2026-11-02T00:00:00Z" }];

    expect(await sitemap()).toEqual([
      { url: "https://fieldfinder.test/" },
      { url: "https://fieldfinder.test/privacy" },
      { url: "https://fieldfinder.test/terms" },
      { url: "https://fieldfinder.test/venues/test-reserve", lastModified: expect.any(String) as string },
      {
        url: "https://fieldfinder.test/venues/test-reserve/pitches/east-pitch",
        lastModified: expect.any(String) as string,
      },
    ]);
    // Only the published-only views, and only slugs and update times from them.
    expect(db.calls).toHaveLength(2);
    for (const call of db.calls)
      expect(call).toMatch(/^select (venue_slug, )?slug, updated_at from public\.public_(venues|pitches)_v /);
  });

  it("refuses a row that isn't shaped like a published page", async () => {
    db.venues = [{ slug: "", updated_at: "2026-11-01T00:00:00Z" }];
    db.pitches = [];
    await expect(sitemap()).rejects.toThrow();
  });
});
