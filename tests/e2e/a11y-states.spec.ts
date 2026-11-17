import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// axe on the page states no other spec scans (PR 3.13: "axe on every page state"). Together with the
// feature specs (search box open, results, filters, preview, map, sheet buttons, geolocation prompt,
// detail pages, lightbox, journeys) this covers every state. GET /api/venues is answered in the
// browser with synthetic venues (invented names); no database needed.

const SEARCH = "/?lat=-37.814&lng=144.963&place=Melbourne";

function venue(n: number) {
  return {
    id: `5eed0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `test-venue-${String(n)}`,
    name: `Test Venue ${String(n)}`,
    suburb: "Testville",
    state: "VIC",
    location: { latitude: -37.8 - n / 100, longitude: 144.96 + n / 100 },
    access: "public",
    distanceMeters: 900 * n,
    publishedPitchCount: 2,
    matchingPitchCount: 2,
    href: `/venues/test-venue-${String(n)}`,
    amenities: { toilets: "yes" },
    image: null,
    pitchSummary: { surfaces: ["grass"], formats: ["full"], floodlights: true },
  };
}

async function blocking(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test.describe("axe: page states not scanned elsewhere", () => {
  test("results failed to load (with Retry)", async ({ page }) => {
    await page.route("**/api/venues?**", (route) =>
      route.fulfill({ status: 500, json: { code: "internal", message: "x", requestId: "r" } }),
    );
    await page.goto(SEARCH);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(await blocking(page)).toEqual([]);
  });

  test("no venues match (Edit filters / Search another area)", async ({ page }) => {
    await page.route("**/api/venues?**", (route) =>
      route.fulfill({ json: { items: [], totalCount: 0, nextCursor: null } }),
    );
    await page.goto(`${SEARCH}&surface=hybrid`);
    await expect(page.getByText("No venues match this search.")).toBeVisible();
    expect(await blocking(page)).toEqual([]);
  });

  test("'Show more' failed", async ({ page }) => {
    await page.route("**/api/venues?**", (route) => {
      const more = new URL(route.request().url()).searchParams.has("cursor");
      return more
        ? route.fulfill({ status: 503, json: { code: "unavailable", message: "x", requestId: "r" } })
        : route.fulfill({ json: { items: [venue(1), venue(2)], totalCount: 3, nextCursor: "c1" } });
    });
    await page.goto(SEARCH);
    await page.getByRole("button", { name: "Show more venues" }).click();
    // (Next.js adds its own route-announcer alert to every page, so pick ours by its text.)
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't load more venues." })).toBeVisible();
    expect(await blocking(page)).toEqual([]);
  });

  test("'Search this area' offered after moving the map", async ({ page }) => {
    await page.route("**/api/venues?**", (route) =>
      route.fulfill({ json: { items: [venue(1), venue(2)], totalCount: 2, nextCursor: null } }),
    );
    await page.goto(SEARCH);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByRole("button", { name: "Search this area" })).toBeVisible();
    expect(await blocking(page)).toEqual([]);
  });

  test("location access denied (message, manual search still offered)", async ({ page, context }) => {
    await context.addInitScript(() => {
      navigator.permissions.query = () =>
        Promise.resolve({ state: "denied", onchange: null } as unknown as PermissionStatus);
      navigator.geolocation.getCurrentPosition = (_ok, fail) => {
        setTimeout(() => fail?.({ code: 1, message: "denied" } as GeolocationPositionError), 10);
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Location access is off/ })).toBeVisible();
    expect(await blocking(page)).toEqual([]);
  });

  test("the 404 page", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page");
    expect(await blocking(page)).toEqual([]);
  });

  test.describe("phone sheet", () => {
    test.skip(({ isMobile }) => !isMobile, "the sheet is the phone layout");

    for (const snap of ["Map", "List"] as const) {
      test(`at the ${snap} snap`, async ({ page }) => {
        await page.route("**/api/venues?**", (route) =>
          route.fulfill({ json: { items: [venue(1), venue(2)], totalCount: 2, nextCursor: null } }),
        );
        await page.goto(SEARCH);
        await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();
        await page.getByRole("group", { name: "Results size" }).getByRole("button", { name: snap }).click();
        await expect(page.getByRole("separator", { name: "Resize results" })).toHaveAttribute(
          "aria-valuetext",
          `${snap} view`,
        );
        expect(await blocking(page)).toEqual([]);
      });
    }
  });
});
