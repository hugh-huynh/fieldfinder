import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The mobile results sheet (PR 3.8, D19) on the phone projects, over the WebGL-free FakeMap.
// GET /api/venues is answered in the browser with synthetic venues (invented names). The one venue
// sits north-west of the searched place, so its marker is in the map's top-left corner: visible
// above the sheet at every snap, and clear of the map controls (top right).

test.skip(({ isMobile }) => !isMobile, "the sheet is the phone layout");

// Snaps settle instantly with reduced motion, so each drag starts from a handle at rest. (The drag
// that failed on CI was a real bug, fixed in SearchLayout: a release read the last move's state before
// it had rendered.)
test.use({ reducedMotion: "reduce" });

const SEARCH = "/?lat=-37.814&lng=144.963&place=Melbourne";
const MARKER = "North West Test Park, 3 pitches";

async function mockSearch(page: Page) {
  await page.route("**/api/venues?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "5eed0000-0000-4000-8000-000000000001",
            slug: "north-west-test-park",
            name: "North West Test Park",
            suburb: "Testville",
            state: "VIC",
            location: { latitude: -37.78, longitude: 144.93 },
            access: "public",
            distanceMeters: 4200,
            publishedPitchCount: 3,
            matchingPitchCount: 3,
            href: "/venues/north-west-test-park",
            amenities: {},
            image: null,
            pitchSummary: { surfaces: ["grass"], formats: [], floodlights: null },
          },
        ],
        totalCount: 1,
        nextCursor: null,
      },
    }),
  );
}

const splitter = (page: Page) => page.getByRole("separator", { name: "Resize results" });
const sheet = (page: Page) => page.getByRole("region", { name: "Results" });
const sizeButton = (page: Page, name: string) =>
  page.getByRole("group", { name: "Results size" }).getByRole("button", { name });

async function sheetHeight(page: Page): Promise<number> {
  const box = await sheet(page).boundingBox();
  if (box === null) throw new Error("no sheet");
  return box.height;
}

/** Drag the handle by `dy` px (negative = up), as a finger would. */
async function dragHandle(page: Page, dy: number) {
  const box = await splitter(page).boundingBox();
  if (box === null) throw new Error("no handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(x, y + (dy * i) / 6);
  await page.mouse.up();
}

/** Tags the map's element, so a later check can tell if it was replaced (remounted). */
async function tagMap(page: Page) {
  await page.getByTestId("fake-map").evaluate((el) => {
    el.setAttribute("data-e2e-original", "yes");
  });
}

test.beforeEach(async ({ page }) => {
  await mockSearch(page);
  await page.goto(SEARCH);
  await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Split view");
  // Let the starting size settle (it animates unless reduced motion is on).
  await expect.poll(() => sheetHeight(page)).toBeGreaterThan(300);
});

test("dragging the handle reaches all three snaps, and the map is never replaced", async ({ page }) => {
  await tagMap(page);
  const balanced = await sheetHeight(page);

  await dragHandle(page, -260);
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "List view");
  await expect.poll(() => sheetHeight(page)).toBeGreaterThan(balanced + 200);

  // Dragging past the largest snap stays there.
  await dragHandle(page, -100);
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "List view");

  await dragHandle(page, 480);
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Map view");
  await expect.poll(() => sheetHeight(page)).toBeLessThan(200);

  await dragHandle(page, -230);
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Split view");

  await expect(page.getByTestId("fake-map")).toHaveAttribute("data-e2e-original", "yes");
  await expect(page.getByRole("status").filter({ hasText: "Showing the map and the list" })).toHaveCount(1);
});

test("the buttons and the keyboard reach all three snaps", async ({ page }) => {
  await tagMap(page);
  await sizeButton(page, "List").click();
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "List view");
  await sizeButton(page, "Map").click();
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Map view");
  await sizeButton(page, "Split").click();
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Split view");

  await splitter(page).focus();
  await page.keyboard.press("End");
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "List view");
  await page.keyboard.press("ArrowDown");
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Split view");
  await page.keyboard.press("Home");
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Map view");
  await expect(page.getByTestId("fake-map")).toHaveAttribute("data-e2e-original", "yes");

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

for (const snap of ["Map", "Split", "List"] as const) {
  test(`the marker preview works from the ${snap} snap`, async ({ page }) => {
    await sizeButton(page, snap).click();
    const marker = page.getByRole("region", { name: "Map of venues" }).getByRole("button", { name: MARKER });
    await marker.click();
    const preview = page.getByRole("dialog", { name: "North West Test Park" });
    await expect(preview).toBeVisible();
    await expect(preview).toBeInViewport({ ratio: 1 });
    await expect(preview.getByRole("link")).toBeFocused();
    await expect(page).toHaveURL(SEARCH);
    // From the list view the sheet makes room so the map and preview show.
    if (snap === "List") await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Split view");
    // The preview sits above the sheet, not under it (once the sheet has finished resizing).
    await expect
      .poll(async () => {
        const previewBox = await preview.boundingBox();
        const sheetBox = await sheet(page).boundingBox();
        return (sheetBox?.y ?? 0) - ((previewBox?.y ?? 0) + (previewBox?.height ?? 0));
      })
      .toBeGreaterThanOrEqual(0);

    await preview.click();
    await expect(page).toHaveURL(/\/venues\/north-west-test-park$/);
  });
}

test("keyboard focus moving into the map shows the map, so nothing focused is hidden under the sheet", async ({
  page,
  browserName,
}) => {
  // Safari's Tab skips links and buttons unless the person turns on "Press Tab to highlight each
  // item", so Tab can't reach the map there; mobile Chromium covers this.
  test.skip(browserName === "webkit", "WebKit's Tab skips links and buttons by default");
  await sizeButton(page, "List").click();
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "List view");
  const inMap = () => page.evaluate(() => document.activeElement?.closest('[aria-label="Map of venues"]') !== null);
  await splitter(page).focus();
  for (let i = 0; i < 25 && !(await inMap()); i += 1) await page.keyboard.press("Tab");
  expect(await inMap()).toBe(true);
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Map view");
  await expect(page.locator(":focus")).toBeInViewport({ ratio: 1 });
});

test("tapping a marker doesn't collapse the sheet", async ({ page }) => {
  await page.getByRole("region", { name: "Map of venues" }).getByRole("button", { name: MARKER }).click();
  await expect(splitter(page)).toHaveAttribute("aria-valuetext", "Split view");
});
