import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The search map (PR 3.4) at every agreed viewport, drawn by the WebGL-free FakeMap
// (NEXT_PUBLIC_MAP_ADAPTER=fake, set by playwright.config.ts when it builds). GET /api/venues is
// answered in the browser with synthetic venues (invented names), so no database or Mapbox is needed.

const SEARCH = "/?lat=-37.814&lng=144.963&place=Melbourne";

function venue(n: number, name: string, publishedPitchCount: number) {
  return {
    id: `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `test-venue-${String(n)}`,
    name,
    suburb: "Testville",
    state: "VIC",
    location: { latitude: -37.8 + n / 100, longitude: 144.96 + n / 100 },
    access: "public",
    distanceMeters: 900 * n,
    publishedPitchCount,
    matchingPitchCount: 1,
    href: `/venues/test-venue-${String(n)}`,
    amenities: {},
    image: null,
    pitchSummary: { surfaces: ["grass"], formats: [], floodlights: null },
  };
}

async function mockSearch(page: Page) {
  await page.route("**/api/venues?**", (route) =>
    route.fulfill({
      json: {
        items: [venue(1, "North Test Reserve", 1), venue(2, "Royal Test Park", 4), venue(3, "South Test Oval", 2)],
        totalCount: 3,
        nextCursor: null,
      },
    }),
  );
}

test.describe("search map", () => {
  test("shows a marker per venue, named by venue and pitch count, and a chosen marker stands out", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    const map = page.getByRole("region", { name: "Map of venues" });
    await expect(map.getByRole("button", { name: /pitch/ })).toHaveCount(3);
    const royal = map.getByRole("button", { name: "Royal Test Park, 4 pitches" });
    await expect(royal).toHaveText("4");
    await expect(royal).toBeVisible();

    await royal.click();
    await expect(royal).toHaveAttribute("aria-expanded", "true");
    // Choosing a marker previews (3.5); it never navigates on its own.
    await expect(page).toHaveURL(SEARCH);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("highlights the marker of the card under keyboard focus", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    const list = page.getByRole("list", { name: "Venues" });
    const map = page.getByRole("region", { name: "Map of venues" });
    await list.getByRole("link", { name: "Royal Test Park" }).focus();
    await expect(map.getByRole("button", { name: "Royal Test Park, 4 pitches" })).toHaveAttribute(
      "data-marker-state",
      "highlighted",
    );
    await list.getByRole("link", { name: "South Test Oval" }).focus();
    await expect(map.getByRole("button", { name: "Royal Test Park, 4 pitches" })).toHaveAttribute(
      "data-marker-state",
      "default",
    );
    await expect(map.getByRole("button", { name: "South Test Oval, 2 pitches" })).toHaveAttribute(
      "data-marker-state",
      "highlighted",
    );
  });

  test("has zoom and recentre buttons", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    const map = page.getByRole("region", { name: "Map of venues" });
    for (const name of ["Recentre map", "Zoom in", "Zoom out"]) {
      await expect(map.getByRole("button", { name })).toBeVisible();
    }
    await map.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByTestId("fake-map")).toHaveAttribute("data-zoom-steps", "1");
    await map.getByRole("button", { name: "Recentre map" }).click();
    await expect(page.getByTestId("fake-map")).toHaveAttribute("data-zoom-steps", "0");
  });
});

test.describe("search map (desktop pointer)", () => {
  test.skip(({ isMobile }) => isMobile, "hover needs a pointer");

  test("highlights the marker of the hovered card", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    await page.getByRole("list", { name: "Venues" }).getByRole("link", { name: "North Test Reserve" }).hover();
    await expect(
      page.getByRole("region", { name: "Map of venues" }).getByRole("button", { name: "North Test Reserve, 1 pitch" }),
    ).toHaveAttribute("data-marker-state", "highlighted");
  });
});
