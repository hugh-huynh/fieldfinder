import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// `/venues/[venueSlug]/pitches/[pitchSlug]` (PR 3.11) against the LOCAL seeded database (synthetic
// venues from tests/fixtures/venues.ts). Needs `pnpm db:start` and E2E_DB=1; skipped otherwise.
// Every private record in the seed carries PRIVATE_SENTINEL in its name.

const PRIVATE_SENTINEL = "ff-private-sentinel";

test.skip(process.env.E2E_DB !== "1", "needs the local database: pnpm db:start, then E2E_DB=1 pnpm e2e");

/** The value beside a spec's label in the "Pitch details" list. */
async function specs(page: Page): Promise<Record<string, string>> {
  return page.getByRole("region", { name: "Pitch details" }).evaluate((section) => {
    const out: Record<string, string> = {};
    for (const dt of section.querySelectorAll("dt")) {
      out[dt.textContent] = dt.nextElementSibling?.textContent ?? "";
    }
    return out;
  });
}

test.describe("pitch page", () => {
  test("a single-pitch venue's pitch: its specs, the venue's facilities and directions", async ({ page }) => {
    const response = await page.goto("/venues/wattlebird-reserve/pitches/main-pitch");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Main Pitch at Wattlebird Reserve, Carlton North · FieldFinder");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Main Pitch");
    expect(await specs(page)).toEqual({
      Surface: "Synthetic",
      "Pitch size": "Full size",
      Dimensions: "105 × 68 m",
      Floodlights: "Yes",
      Access: "Public access (the venue's rule)",
    });
    const facilities = page.getByRole("region", { name: "Facilities at Wattlebird Reserve" });
    await expect(facilities).toContainText("ParkingYes");
    await expect(facilities).toContainText("Drinking waterNot confirmed");
    await expect(page.getByRole("link", { name: /Get directions/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=-37.784%2C144.972",
    );
    // One pitch: no "see all", but the venue page is still linked.
    await expect(page.getByRole("link", { name: "See all pitches" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Wattlebird Reserve" })).toHaveAttribute(
      "href",
      "/venues/wattlebird-reserve",
    );

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("a pitch with nothing confirmed says 'Not confirmed', even under a uuid-shaped slug", async ({ page }) => {
    const response = await page.goto("/venues/ironbark-park/pitches/5eed0000-0000-4000-8001-000000000002");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pitch D");
    expect(await specs(page)).toEqual({
      Surface: "Not confirmed",
      "Pitch size": "Not confirmed",
      Dimensions: "Not confirmed",
      Floodlights: "Not confirmed",
      Access: "Public access (the venue's rule)",
    });
    await expect(page.getByRole("link", { name: "See all pitches" })).toHaveAttribute("href", "/venues/ironbark-park");
  });

  test("a pitch with its own access rule says so", async ({ page }) => {
    await page.goto("/venues/ironbark-park/pitches/pitch-c");
    expect((await specs(page)).Access).toBe("Members only (this pitch's own rule)");
  });

  for (const [why, path] of [
    ["a draft pitch", "/venues/banksias-corner-reserve/pitches/draft-pitch"],
    ["an archived pitch", "/venues/saltbush-sports-park/pitches/old-pitch"],
    ["a published pitch under a draft venue", "/venues/hidden-draft-park/pitches/pitch-1"],
    ["a published pitch under an archived venue", "/venues/old-mill-oval/pitches/pitch-1"],
    ["another venue's pitch", "/venues/wattlebird-reserve/pitches/pitch-a"],
    ["a pitch that doesn't exist", "/venues/ironbark-park/pitches/no-such-pitch"],
    ["a malformed slug", "/venues/ironbark-park/pitches/Not%20A%20Slug!"],
  ] as const) {
    test(`${why} is the 404 page, giving nothing away`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page");
      const html = (await response?.text()) ?? "";
      expect(html).not.toContain(PRIVATE_SENTINEL);
      for (const hidden of ["Draft Pitch", "Old Pitch", "Hidden Draft Park", "Old Mill Oval"]) {
        expect(html).not.toContain(hidden);
      }
    });
  }

  test("the HTML of a public pitch has nothing unpublished in it", async ({ request }) => {
    const response = await request.get("/venues/saltbush-sports-park/pitches/east-pitch");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain(PRIVATE_SENTINEL);
    expect(html).not.toContain("Old Pitch");
  });

  test("from a venue page, a pitch card opens the pitch, and the venue link returns", async ({ page }) => {
    await page.goto("/venues/ironbark-park");
    await page.getByRole("region", { name: "Pitches" }).getByRole("link", { name: "Pitch B" }).click();
    await expect(page).toHaveURL(/\/venues\/ironbark-park\/pitches\/pitch-b$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pitch B");
    await page.getByRole("link", { name: "Ironbark Park" }).click();
    await expect(page).toHaveURL(/\/venues\/ironbark-park$/);
  });
});
