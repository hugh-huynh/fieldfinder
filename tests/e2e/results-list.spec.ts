import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Results list (PR 3.3) at every agreed viewport. GET /api/venues is answered in the browser with
// synthetic venues (invented names), so no database is needed.

const SEARCH = "/?lat=-37.814&lng=144.963&place=Melbourne";
// A 1×1 PNG, served for the one venue that has a photo.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function venue(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `test-venue-${String(n)}`,
    name: `Test Venue ${String(n)}`,
    suburb: "Testville",
    state: "VIC",
    location: { latitude: -37.8, longitude: 144.96 },
    access: "public",
    distanceMeters: 900 * n,
    publishedPitchCount: 2,
    matchingPitchCount: 2,
    href: `/venues/test-venue-${String(n)}`,
    amenities: { toilets: "yes", parking: "no" },
    image: null,
    pitchSummary: { surfaces: ["grass"], formats: ["full"], floodlights: true },
    ...extra,
  };
}

async function mockSearch(page: Page, pages: { ids: number[]; next: string | null }[], total: number) {
  // The photo is fetched straight from its (fake) origin, or, when the build has image optimisation on
  // (3.12), through /_next/image with that URL: answer both in the browser.
  await page.route("**/media.test/**", (route) => route.fulfill({ body: PIXEL, contentType: "image/png" }));
  await page.route(/\/_next\/image\?url=https%3A%2F%2Fmedia\.test/, (route) =>
    route.fulfill({ body: PIXEL, contentType: "image/png" }),
  );
  await page.route("**/api/venues?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const p = pages[cursor === null ? 0 : Number(cursor.slice(1))] ?? { ids: [], next: null };
    const items = p.ids.map((n) =>
      venue(
        n,
        n === 1
          ? {
              image: {
                id: "5eed0000-0000-4000-8000-0000000000aa",
                url: "https://media.test/p/one.png",
                contentType: "image/webp",
                width: 400,
                height: 300,
                alt: "A grass pitch at dusk",
                displayOrder: 0,
                attribution: null,
              },
            }
          : {},
      ),
    );
    await route.fulfill({ json: { items, totalCount: total, nextCursor: p.next } });
  });
}

test.describe("results list", () => {
  test("shows venue cards with confirmed facts only, and grows with Show more from the keyboard", async ({ page }) => {
    await mockSearch(
      page,
      [
        { ids: [1, 2], next: "c1" },
        { ids: [3], next: null },
      ],
      3,
    );
    await page.goto(SEARCH);
    const list = page.getByRole("list", { name: "Venues" });
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Test Venue 1", "Test Venue 2"]);
    await expect(page.getByRole("img", { name: "A grass pitch at dusk" })).toBeVisible();
    await expect(list.getByRole("link", { name: "Test Venue 1" })).toHaveAttribute("href", "/venues/test-venue-1");
    await expect(list.getByText("Toilets").first()).toBeVisible();
    await expect(list.getByText(/parking/i)).toHaveCount(0);

    const more = page.getByRole("button", { name: "Show more venues" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(["Test Venue 1", "Test Venue 2", "Test Venue 3"]);
    await expect(list.getByRole("link", { name: "Test Venue 3" })).toBeFocused();
    await expect(more).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("has no serious accessibility violations with results showing", async ({ page }) => {
    await mockSearch(page, [{ ids: [1, 2, 3], next: "c1" }], 9);
    await page.goto(SEARCH);
    await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("no results: Search another area puts focus in the search box", async ({ page }) => {
    await mockSearch(page, [{ ids: [], next: null }], 0);
    await page.goto(SEARCH);
    await expect(page.getByText("No venues match this search.")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await page.getByRole("button", { name: "Search another area" }).click();
    await expect(page.getByRole("combobox", { name: "Search a suburb or place" })).toBeFocused();
  });
});
