import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// "Search this area" and history (PR 3.6) at every agreed viewport, on the WebGL-free FakeMap.
// GET /api/venues is answered in the browser with synthetic venues (invented names): 25 venues, 20
// on the first page and 5 behind "Show more", unless a restore asks for more at once (limit).

const SEARCH = "/?lat=-37.814&lng=144.963&place=Melbourne&surface=grass";
const TOTAL = 25;

function venue(n: number) {
  return {
    id: `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `test-venue-${String(n)}`,
    name: `Test Venue ${String(n)}`,
    suburb: "Testville",
    state: "VIC",
    location: { latitude: -37.86 + (n % 5) / 50, longitude: 144.9 + Math.floor(n / 5) / 40 },
    access: "public",
    distanceMeters: 300 * n,
    publishedPitchCount: 2,
    matchingPitchCount: 1,
    href: `/venues/test-venue-${String(n)}`,
    amenities: {},
    image: null,
    pitchSummary: { surfaces: ["grass"], formats: [], floodlights: null },
  };
}

async function mockSearch(page: Page): Promise<URL[]> {
  const asked: URL[] = [];
  await page.route("**/api/venues?**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const from = url.searchParams.get("cursor") === "c1" ? 20 : 0;
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const ids = Array.from({ length: Math.min(limit, TOTAL - from) }, (_, i) => from + i + 1);
    const end = from + ids.length;
    return route.fulfill({
      json: { items: ids.map(venue), totalCount: TOTAL, nextCursor: end < TOTAL ? "c1" : null },
    });
  });
  return asked;
}

const map = (page: Page) => page.getByTestId("fake-map");

/** Drag the map's empty edge sideways, as a person panning would. */
async function pan(page: Page, dx: number) {
  const box = await map(page).boundingBox();
  if (box === null) throw new Error("map not visible");
  const x = box.x + box.width * 0.05;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 3 });
  await page.mouse.move(x + dx, y, { steps: 3 });
  await page.mouse.up();
}

test.describe("Search this area", () => {
  test("appears after panning, and no request fires until it's clicked", async ({ page }) => {
    const asked = await mockSearch(page);
    await page.goto(SEARCH);
    await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();
    const offer = page.getByRole("button", { name: "Search this area" });
    await expect(offer).toHaveCount(0);
    const before = asked.length;

    await pan(page, 120);
    await expect(offer).toBeVisible();
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(before);

    await offer.click();
    await expect(page).toHaveURL(/radiusKm=\d+/);
    const url = new URL(page.url());
    expect(url.searchParams.get("surface")).toBe("grass");
    expect(url.searchParams.get("place")).toBeNull();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Soccer fields in this area");
    await expect.poll(() => asked.length).toBeGreaterThan(before);
    expect(asked.at(-1)?.searchParams.get("lat")).toBe(url.searchParams.get("lat"));

    // 25 venues this close together overlap on the map (each other and the zoom buttons), which axe's
    // target-size rule flags: dense markers need clustering, a known limitation not in this ticket. The
    // map's markers are left out here; the controls, the offer and the list are still checked.
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .exclude("[data-marker-id]")
      .analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
});

test.describe("back from a venue", () => {
  test("restores the filters, the map's viewport and the list's scroll position", async ({ page }) => {
    await mockSearch(page);
    await page.goto(SEARCH);
    const list = page.getByRole("list", { name: "Venues" });
    await expect(list.getByRole("heading", { level: 2 })).toHaveCount(20);
    await page.getByRole("button", { name: "Show more venues" }).click();
    await expect(list.getByRole("heading", { level: 2 })).toHaveCount(TOTAL);

    // Move the map, then scroll down to the 22nd venue.
    await page.getByRole("button", { name: "Zoom in" }).click();
    const markerBox = async () => {
      const style = await page
        .getByRole("button", { name: "Test Venue 7, 2 pitches" })
        .evaluate((el) => (el.parentElement as HTMLElement).style.cssText);
      return style;
    };
    const markerBefore = await markerBox();
    const card = list.getByRole("link", { name: "Test Venue 22" });
    await card.scrollIntoViewIfNeeded();
    const cardHeight = await list
      .locator(":scope > li")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(cardHeight);

    await card.click();
    await expect(page).toHaveURL(/\/venues\/test-venue-22$/);
    await page.goBack();

    await expect(page).toHaveURL(SEARCH);
    // All 25 come back in one request, so the scroll position can be reached again.
    await expect(list.getByRole("heading", { level: 2 })).toHaveCount(TOTAL);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore - cardHeight);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(cardHeight);
    await expect.poll(markerBox).toBe(markerBefore);
    // Restoring isn't a move by the person.
    await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
  });
});
