import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// App shell and header (PR 3.2) at every agreed viewport (desktop 1440, Pixel 7 and iPhone 390).
// /api/locations/suggest is answered in the browser with synthetic places: no Mapbox call is made.

const PLACES = [
  {
    id: "test.brunswick",
    name: "Brunswick",
    label: "Brunswick, Victoria 3056, Australia",
    type: "locality",
    latitude: -37.767,
    longitude: 144.962,
  },
  {
    id: "test.brunswick-east",
    name: "Brunswick East",
    label: "Brunswick East, Victoria 3057, Australia",
    type: "locality",
    latitude: -37.772,
    longitude: 144.979,
  },
];

async function mockSuggest(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/api/locations/suggest?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    asked.push(q);
    const suggestions = PLACES.filter((p) => p.name.toLowerCase().startsWith(q.toLowerCase()));
    await route.fulfill({ json: { suggestions }, headers: { "cache-control": "no-store" } });
  });
  return asked;
}

test.describe("search header", () => {
  test("has exactly one search box and one Filters button, side by side, and no sideways scroll", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("combobox", { name: "Search a suburb or place" });
    const filters = page.getByRole("button", { name: /^Filters/ });
    await expect(box).toHaveCount(1);
    await expect(filters).toHaveCount(1);
    await expect(box).toBeVisible();
    await expect(filters).toBeVisible();

    const [b, f] = [await box.boundingBox(), await filters.boundingBox()];
    if (b === null || f === null) throw new Error("not laid out");
    expect(f.x).toBeGreaterThan(b.x + b.width - 1); // to the right of the box
    expect(Math.abs(f.y + f.height / 2 - (b.y + b.height / 2))).toBeLessThan(16); // on the same row
    expect(f.height).toBeGreaterThanOrEqual(24); // WCAG 2.5.8 target size
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("keyboard: type, choose with the arrows and Enter, land on the results for that place", async ({ page }) => {
    const asked = await mockSuggest(page);
    await page.goto("/?surface=grass");
    const box = page.getByRole("combobox", { name: "Search a suburb or place" });
    await box.focus();
    await page.keyboard.type("Brun");
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/\?lat=-37\.772&lng=144\.979&place=Brunswick\+East,\+Victoria\+3057&surface=grass$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Soccer fields near Brunswick East, Victoria 3057",
    );
    await expect(box).toHaveValue("Brunswick East, Victoria 3057");
    expect(asked).toEqual(["Brun"]);
  });

  test("back restores the previous place in the box", async ({ page }) => {
    await page.goto("/?lat=-37.767&lng=144.962&place=Brunswick");
    await page.goto("/?lat=-37.814&lng=144.963&place=Melbourne");
    await page.goBack();
    await expect(page.getByRole("combobox")).toHaveValue("Brunswick");
  });

  test("has no serious accessibility violations with the list open", async ({ page }) => {
    await mockSuggest(page);
    await page.goto("/");
    await page.getByRole("combobox").fill("Brun");
    await expect(page.getByRole("option")).toHaveCount(2);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
