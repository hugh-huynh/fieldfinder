import { expect, test, type Page } from "@playwright/test";

// Screenshot baselines (PR 3.13) for the screens Hugh approved on 2026-11-17, at the agreed sizes:
// desktop 1440×900 (desktop-chromium) and phone 390×844 (mobile-chromium). Against the LOCAL seeded
// database with its synthetic placeholder photos and the WebGL-free FakeMap, so every pixel is
// deterministic.
//
// Linux only: baselines are made in Playwright's Linux image (scripts/visual-baselines.sh) to match
// CI's runner; fonts render differently on macOS. CI's full E2E job compares against them on main and
// nightly. WebKit is left out: one engine per size keeps the baselines meaningful, not noisy.
//
// Photos are masked: their boxes (size, place, crop) are compared, not their pixels. The fixture
// placeholders are drawn by sharp with the host's own sans-serif font, so the same photo differs
// between CI's runner and Playwright's image; they're test content, not part of the design.

test.skip(process.env.E2E_DB !== "1", "needs the local database: pnpm db:start, then E2E_DB=1 pnpm e2e");
test.skip(process.platform !== "linux", "baselines are Linux renderings (scripts/visual-baselines.sh)");
test.skip(({ browserName }) => browserName !== "chromium", "one engine per agreed size");

const SEARCH = "/?lat=-37.784&lng=144.968&place=Carlton+North%2C+Victoria+3054";

/** A screenshot of the whole viewport, photos masked with a flat neutral fill. */
async function screenshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, { mask: [page.locator("img")], maskColor: "#dce5df" });
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

async function results(page: Page) {
  await page.goto(SEARCH);
  await page.getByRole("list", { name: "Venues" }).waitFor();
  await settle(page);
}

test.describe("visual baselines", () => {
  test.use({ reducedMotion: "reduce" });

  test("landing", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await screenshot(page, "landing.png");
  });

  test("results", async ({ page }) => {
    await results(page);
    await screenshot(page, "results.png");
  });

  test("phone sheet: list and map views", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the sheet is the phone layout");
    await results(page);
    const sizes = page.getByRole("group", { name: "Results size" });
    await sizes.getByRole("button", { name: "List" }).click();
    await screenshot(page, "results-list-view.png");
    await sizes.getByRole("button", { name: "Map" }).click();
    await screenshot(page, "results-map-view.png");
  });

  test("marker preview", async ({ page }) => {
    await results(page);
    await page
      .getByRole("region", { name: "Map of venues" })
      .getByRole("button", { name: "Ironbark Park, 4 pitches" })
      .click();
    await page.getByRole("dialog", { name: "Ironbark Park" }).waitFor();
    await settle(page);
    await screenshot(page, "marker-preview.png");
  });

  test("filters", async ({ page }) => {
    await results(page);
    await page
      .getByRole("search")
      .getByRole("button", { name: /^Filters/ })
      .click();
    await page.getByRole("dialog", { name: "Filters" }).waitFor();
    await screenshot(page, "filters.png");
  });

  test("no results", async ({ page }) => {
    await page.goto(`${SEARCH}&surface=hybrid&pitchSize=training&radiusKm=1`);
    await page.getByText("No venues match this search.").waitFor();
    await settle(page);
    await screenshot(page, "no-results.png");
  });

  test("venue page", async ({ page }) => {
    await page.goto("/venues/ironbark-park");
    await settle(page);
    await screenshot(page, "venue.png");
  });

  test("photo viewer", async ({ page }) => {
    await page.goto("/venues/ironbark-park");
    await settle(page);
    await page.getByRole("button", { name: /Open photo 1 of 2/ }).click();
    await page.getByRole("dialog", { name: "Photo 1 of 2" }).waitFor();
    await settle(page);
    await screenshot(page, "photo-viewer.png");
  });

  test("pitch page", async ({ page }) => {
    await page.goto("/venues/wattlebird-reserve/pitches/main-pitch");
    await settle(page);
    await screenshot(page, "pitch.png");
  });

  test("not found", async ({ page }) => {
    await page.goto("/no-such-page");
    await settle(page);
    await screenshot(page, "not-found.png");
  });
});
