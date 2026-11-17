import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Whole journeys (spec §9, PR 3.13) against the REAL app: GET /api/venues and the detail pages read
// the LOCAL seeded database (synthetic venues), with the WebGL-free FakeMap. Only the place
// suggestions are answered in the browser (they'd call Mapbox). Needs `pnpm db:start` and E2E_DB=1.

test.skip(process.env.E2E_DB !== "1", "needs the local database: pnpm db:start, then E2E_DB=1 pnpm e2e");

async function mockSuggest(page: Page) {
  await page.route("**/api/locations/suggest?**", (route) =>
    route.fulfill({
      json: {
        suggestions: [
          {
            id: "test.carlton-north",
            name: "Carlton North",
            label: "Carlton North, Victoria 3054, Australia",
            type: "locality",
            latitude: -37.784,
            longitude: 144.968,
          },
        ],
      },
      headers: { "cache-control": "no-store" },
    }),
  );
}

async function axe(page: Page) {
  // After a client-side navigation Next.js fills in <title> a moment later; scan once it's there.
  await expect(page).toHaveTitle(/FieldFinder/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    // Real seeded venues sit close together, so their markers can overlap (no clustering yet: a known
    // limitation); the target-size rule is checked on the map's controls in the map specs.
    .exclude("[data-marker-id]")
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

/** Type a place and choose it from the list with the keyboard. */
async function searchCarltonNorth(page: Page) {
  const box = page.getByRole("search").getByRole("combobox");
  await box.click();
  await box.pressSequentially("Carlton", { delay: 20 });
  await expect(page.getByRole("option", { name: /Carlton North/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Soccer fields near Carlton North, Victoria 3054");
}

test.describe("desktop journey", () => {
  test.skip(({ isMobile }) => isMobile, "the desktop journey");

  test("search → filter → map preview → venue → pitch → back to the same results", async ({ page }) => {
    await mockSuggest(page);
    await page.goto("/");
    await searchCarltonNorth(page);

    const list = page.getByRole("list", { name: "Venues" });
    const map = page.getByRole("region", { name: "Map of venues" });
    await expect(list.getByRole("link", { name: "Wattlebird Reserve" })).toBeVisible();
    await expect(list.getByRole("link", { name: "Ironbark Park" })).toBeVisible();
    await expect(list.getByRole("link", { name: "Banksia's Corner Reserve" })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    // Filters: synthetic only. Nothing changes until "Show venues".
    await page
      .getByRole("search")
      .getByRole("button", { name: /^Filters/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await dialog.getByText("Synthetic", { exact: true }).click();
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Show venues" }).click();
    await expect(page).toHaveURL(/surface=synthetic/);
    // Banksia's Corner has only grass published (its synthetic pitch is a draft).
    await expect(list.getByRole("link", { name: "Banksia's Corner Reserve" })).toHaveCount(0);
    await expect(list.getByRole("link", { name: "Ironbark Park" })).toBeVisible();
    const filteredUrl = page.url();

    // The list points at the map; choosing a marker previews; the preview opens the venue.
    await list.getByRole("link", { name: "Ironbark Park" }).focus();
    await expect(map.getByRole("button", { name: "Ironbark Park, 4 pitches" })).toHaveAttribute(
      "data-marker-state",
      "highlighted",
    );
    await map.getByRole("button", { name: "Ironbark Park, 4 pitches" }).click();
    const preview = page.getByRole("dialog", { name: "Ironbark Park" });
    await expect(preview).toBeVisible();
    await expect(page).toHaveURL(filteredUrl);
    await preview.click();

    await expect(page).toHaveURL(/\/venues\/ironbark-park$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ironbark Park");
    expect(await axe(page)).toEqual([]);
    await page.getByRole("region", { name: "Pitches" }).getByRole("link", { name: "Pitch C" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pitch C");
    expect(await axe(page)).toEqual([]);

    // Back, back: the same search, with its filters, list and map.
    await page.goBack();
    await expect(page).toHaveURL(/\/venues\/ironbark-park$/);
    await page.goBack();
    await expect(page).toHaveURL(filteredUrl);
    await expect(list.getByRole("link", { name: "Ironbark Park" })).toBeVisible();
    await expect(list.getByRole("link", { name: "Banksia's Corner Reserve" })).toHaveCount(0);
    await expect(page.getByRole("search").getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
  });
});

test.describe("mobile journey", () => {
  test.skip(({ isMobile }) => !isMobile, "the phone journey");

  test("search → list view → a one-pitch venue opens its pitch page → back", async ({ page }) => {
    await mockSuggest(page);
    await page.goto("/");
    await searchCarltonNorth(page);

    const splitter = page.getByRole("separator", { name: "Resize results" });
    await expect(splitter).toHaveAttribute("aria-valuetext", "Split view");
    await page.getByRole("group", { name: "Results size" }).getByRole("button", { name: "List" }).click();
    await expect(splitter).toHaveAttribute("aria-valuetext", "List view");
    expect(await axe(page)).toEqual([]);

    // Wattlebird Reserve has one published pitch: its card goes straight to the pitch page (spec §1).
    const card = page.getByRole("list", { name: "Venues" }).getByRole("link", { name: "Wattlebird Reserve" });
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page).toHaveURL(/\/venues\/wattlebird-reserve\/pitches\/main-pitch$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Main Pitch");
    expect(await axe(page)).toEqual([]);

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Soccer fields near Carlton North, Victoria 3054");
    await expect(
      page.getByRole("list", { name: "Venues" }).getByRole("link", { name: "Wattlebird Reserve" }),
    ).toBeVisible();
  });
});
