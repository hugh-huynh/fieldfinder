import { expect, test } from "@playwright/test";

// SEO surfaces of the built app (PR 4.2): canonical links, Open Graph and JSON-LD on detail pages,
// robots.txt and sitemap.xml. robots.txt and the sitemap read no browser state, so they run once,
// on desktop. Pages and the sitemap need the LOCAL seeded database (E2E_DB=1).

const PRIVATE_SENTINEL = "ff-private-sentinel";

test.describe("SEO", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "server output: once is enough");

  test("robots.txt keeps crawlers out of anything that isn't production", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toMatch(/User-Agent: \*\s+Disallow: \/\s*$/);
    expect(text).not.toContain("Allow:");
  });

  test.describe("with the database", () => {
    test.skip(process.env.E2E_DB !== "1", "needs the local database: pnpm db:start, then E2E_DB=1 pnpm e2e");

    test("sitemap.xml lists published pages only", async ({ request }) => {
      const response = await request.get("/sitemap.xml");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("xml");
      const xml = await response.text();
      expect(xml).toContain("/venues/ironbark-park</loc>");
      expect(xml).toContain("/venues/ironbark-park/pitches/pitch-c</loc>");
      expect(xml).toContain("/venues/banksias-corner-reserve/pitches/north-pitch</loc>");
      expect(xml).not.toContain("hidden-draft-park");
      expect(xml).not.toContain("old-mill-oval");
      expect(xml).not.toContain("draft-pitch");
      expect(xml).not.toContain(PRIVATE_SENTINEL);
    });

    test("a venue page has its canonical URL, a share card and structured data", async ({ page }) => {
      await page.goto("/venues/ironbark-park");
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/venues\/ironbark-park$/);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", /\/venues\/ironbark-park$/);
      await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "FieldFinder");

      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(blocks).toHaveLength(1);
      const data = JSON.parse(blocks[0] ?? "") as Record<string, unknown>;
      expect(data).toMatchObject({ "@type": "SportsActivityLocation", name: "Ironbark Park" });
      const text = JSON.stringify(data);
      for (const key of ["aggregateRating", "review", "priceRange", "offers", "openingHours"]) {
        expect(text).not.toContain(`"${key}"`);
      }
      expect(text).not.toContain(PRIVATE_SENTINEL);
    });

    test("a pitch page is canonical at its own URL; a missing one is never indexed", async ({ page }) => {
      await page.goto("/venues/ironbark-park/pitches/pitch-c");
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        /\/venues\/ironbark-park\/pitches\/pitch-c$/,
      );
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(JSON.parse(blocks[0] ?? "")).toMatchObject({ containedInPlace: { name: "Ironbark Park" } });

      const missing = await page.goto("/venues/hidden-draft-park");
      expect(missing?.status()).toBe(404);
      // Next marks every notFound() response noindex; exactly once.
      await expect(page.locator('meta[name="robots"]')).toHaveCount(1);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    });
  });

  test("every search URL shares the search page's canonical", async ({ page }) => {
    await page.goto("/?place=Testville&lat=-37.8&lng=144.9&radius=5");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/);
  });
});
