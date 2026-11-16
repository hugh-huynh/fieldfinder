import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The Filters dialog (PR 3.7) at every agreed viewport, on the WebGL-free FakeMap. GET /api/venues
// is answered in the browser with synthetic venues (invented names): grass searches get one venue,
// everything else another, so a test can see the list and the map change together.

const SEARCH = "/?lat=-37.814&lng=144.963&place=Melbourne";

function venue(n: number, name: string) {
  return {
    id: `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `test-venue-${String(n)}`,
    name,
    suburb: "Testville",
    state: "VIC",
    location: { latitude: -37.8, longitude: 144.96 },
    access: "public",
    distanceMeters: 900 * n,
    publishedPitchCount: 2,
    matchingPitchCount: 1,
    href: `/venues/test-venue-${String(n)}`,
    amenities: {},
    image: null,
    pitchSummary: { surfaces: ["grass"], formats: [], floodlights: null },
  };
}

async function mockSearch(page: Page, { empty = false } = {}): Promise<URL[]> {
  const asked: URL[] = [];
  await page.route("**/api/venues?**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const grass = url.searchParams.get("surface") === "grass";
    const items = empty ? [] : [grass ? venue(2, "Grass Test Park") : venue(1, "Any Test Park")];
    return route.fulfill({ json: { items, totalCount: items.length, nextCursor: null } });
  });
  return asked;
}

const filtersButton = (page: Page) => page.getByRole("search").getByRole("button", { name: /^Filters/ });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Filters" });

async function openFilters(page: Page) {
  await filtersButton(page).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("Filters dialog", () => {
  test("changing drafts fires no requests; Cancel restores the previous state and focus", async ({ page }) => {
    const asked = await mockSearch(page);
    await page.goto(`${SEARCH}&surface=grass`);
    await expect(page.getByRole("list", { name: "Venues" })).toContainText("Grass Test Park");
    const before = asked.length;

    await openFilters(page);
    await dialog(page).getByText("Hybrid", { exact: true }).click();
    await dialog(page).getByText("With lighting", { exact: true }).click();
    await dialog(page).getByRole("checkbox", { name: "Toilets" }).check();
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(before);

    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(filtersButton(page)).toBeFocused();
    await expect(page).toHaveURL(`${SEARCH}&surface=grass`);

    await openFilters(page);
    await expect(dialog(page).getByRole("radio", { name: "Grass" })).toBeChecked();
    await expect(dialog(page).getByRole("checkbox", { name: "Toilets" })).not.toBeChecked();
  });

  test("Show venues updates the URL, list and map together, as one history entry", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    const map = page.getByRole("region", { name: "Map of venues" });
    await expect(map.getByRole("button", { name: "Any Test Park, 2 pitches" })).toBeVisible();

    await openFilters(page);
    await dialog(page).getByText("Grass", { exact: true }).click();
    await dialog(page).getByRole("button", { name: "Show venues" }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(`${SEARCH}&surface=grass`);
    await expect(page.getByRole("list", { name: "Venues" })).toContainText("Grass Test Park");
    await expect(map.getByRole("button", { name: "Grass Test Park, 2 pitches" })).toBeVisible();
    await expect(map.getByRole("button", { name: "Any Test Park, 2 pitches" })).toHaveCount(0);
    await expect(filtersButton(page)).toHaveAccessibleName("Filters, 1 active");

    await page.goBack();
    await expect(page).toHaveURL(SEARCH);
    await expect(page.getByRole("list", { name: "Venues" })).toContainText("Any Test Park");
  });

  test("keyboard: focus stays inside, the slider moves with the arrows, Enter applies, Escape cancels", async ({
    page,
  }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    await filtersButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();

    // The page behind is inert: Tab never reaches it. (After the dialog's last control, a native modal
    // lets Tab go to the browser's own toolbar, where nothing on the page has focus.)
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      const onPageBehind = await page.evaluate(() => {
        const active = document.activeElement;
        return active !== null && active !== document.body && active.closest("dialog") === null;
      });
      expect(onPageBehind).toBe(false);
    }

    const slider = dialog(page).getByRole("slider", { name: "Distance" });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(dialog(page).getByText("Within 12 km")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(filtersButton(page)).toBeFocused();
    await expect(page).toHaveURL(SEARCH);

    await page.keyboard.press("Enter");
    await slider.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${SEARCH}&radiusKm=9`);
  });

  test("Clear all resets the draft without searching", async ({ page }) => {
    const asked = await mockSearch(page);
    await page.goto(`${SEARCH}&surface=grass&radiusKm=30`);
    await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();
    const before = asked.length;
    await openFilters(page);
    await dialog(page).getByRole("button", { name: "Clear all" }).click();
    await expect(
      dialog(page).getByRole("group", { name: "Surface type" }).getByRole("radio", { name: "Any" }),
    ).toBeChecked();
    await expect(dialog(page).getByText("Within 10 km")).toBeVisible();
    expect(asked).toHaveLength(before);
    await dialog(page).getByRole("button", { name: "Show venues" }).click();
    await expect(page).toHaveURL(SEARCH);
  });

  test("shows Date & time and Players as not yet available", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    await openFilters(page);
    for (const name of [/Date & time/, /Players/]) {
      const group = dialog(page).getByRole("group", { name });
      await expect(group).toHaveAttribute("aria-disabled", "true");
      await expect(group).toContainText("not yet available");
    }
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("Edit filters (no results) opens the dialog, and closing returns there", async ({ page }) => {
    await mockSearch(page, { empty: true });
    await page.goto(SEARCH);
    const edit = page.getByRole("button", { name: "Edit filters" });
    await edit.click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
  });
});

test.describe("Filters dialog layout", () => {
  test("is a bottom sheet on phones and a centred modal on desktop", async ({ page, isMobile }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    await openFilters(page);
    const box = await dialog(page).boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error("no layout");
    if (isMobile) {
      expect(box.width).toBeCloseTo(viewport.width, 0);
      expect(box.y + box.height).toBeCloseTo(viewport.height, 0);
    } else {
      expect(box.x + box.width / 2).toBeCloseTo(viewport.width / 2, 0);
      expect(box.width).toBeLessThan(viewport.width);
    }
    // The buttons stay reachable without scrolling the page behind.
    await expect(dialog(page).getByRole("button", { name: "Show venues" })).toBeInViewport();
  });
});
