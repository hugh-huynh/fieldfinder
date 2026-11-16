import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Two-step marker preview (PR 3.5) at every agreed viewport, on the WebGL-free FakeMap. The first
// click on a marker only previews; activating the preview navigates to the pitch page for a
// single-pitch venue and to the venue page for a multi-pitch one, even when only one of its pitches
// matches the filters. GET /api/venues is answered in the browser with synthetic venues.

const SEARCH = "/?lat=-37.814&lng=144.963&place=Melbourne&surface=grass";
const PITCH_URL = "/venues/single-test-reserve/pitches/main-pitch";
const VENUE_URL = "/venues/multi-test-park";

function venue(n: number, extra: Record<string, unknown>) {
  return {
    id: `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `test-venue-${String(n)}`,
    name: `Test Venue ${String(n)}`,
    suburb: "Testville",
    state: "VIC",
    location: { latitude: -37.8 + n / 50, longitude: 144.96 + n / 50 },
    access: "public",
    distanceMeters: 900 * n,
    publishedPitchCount: 2,
    matchingPitchCount: 1,
    href: `/venues/test-venue-${String(n)}`,
    amenities: {},
    image: null,
    pitchSummary: { surfaces: ["grass"], formats: [], floodlights: null },
    ...extra,
  };
}

async function mockSearch(page: Page) {
  await page.route("**/api/venues?**", (route) =>
    route.fulfill({
      json: {
        items: [
          venue(1, {
            name: "Single Test Reserve",
            slug: "single-test-reserve",
            publishedPitchCount: 1,
            href: PITCH_URL,
          }),
          venue(2, { name: "Multi Test Park", slug: "multi-test-park", publishedPitchCount: 4, href: VENUE_URL }),
        ],
        totalCount: 2,
        nextCursor: null,
      },
    }),
  );
}

const map = (page: Page) => page.getByRole("region", { name: "Map of venues" });

test.describe("marker preview", () => {
  for (const [name, label, destination] of [
    ["single-pitch venue → its pitch page", "Single Test Reserve, 1 pitch", PITCH_URL],
    ["multi-pitch venue → its venue page, though only 1 of 4 pitches matches", "Multi Test Park, 4 pitches", VENUE_URL],
  ] as const) {
    test(`first click previews, second click navigates: ${name}`, async ({ page }) => {
      await mockSearch(page);
      await page.goto(SEARCH);
      await map(page).getByRole("button", { name: label }).click();

      const preview = page.getByRole("dialog");
      await expect(preview).toBeVisible();
      await expect(preview.getByRole("link")).toBeFocused();
      // The first click never navigates.
      await expect(page).toHaveURL(SEARCH);

      // Anywhere on the card opens it (the name's link is stretched over the card).
      await preview.click();
      await expect(page).toHaveURL(destination);
    });
  }

  test("Escape closes the preview and returns focus to the marker", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    const marker = map(page).getByRole("button", { name: "Multi Test Park, 4 pitches" });
    await marker.click();
    await expect(page.getByRole("dialog", { name: "Multi Test Park" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(marker).toBeFocused();
    await expect(page).toHaveURL(SEARCH);
  });

  test("keyboard: Enter on a marker previews, Enter again opens it", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    await map(page).getByRole("button", { name: "Single Test Reserve, 1 pitch" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByRole("link")).toBeFocused();
    await expect(page).toHaveURL(SEARCH);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(PITCH_URL);
  });

  test("has no serious accessibility violations with the preview open", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    await map(page).getByRole("button", { name: "Multi Test Park, 4 pitches" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
