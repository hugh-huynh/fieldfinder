import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// "Use my location" (PR 3.9) at every agreed viewport. The reverse lookup and the venue search are
// answered in the browser (no Mapbox, no database). Positions are synthetic. A counter wrapped around
// getCurrentPosition (installed before any page script) proves when the position is read.

const PRECISE = { latitude: -37.801234, longitude: 144.966789 };

async function mockApis(page: Page): Promise<string[]> {
  const reverse: string[] = [];
  await page.route("**/api/locations/reverse?**", (route) => {
    reverse.push(new URL(route.request().url()).search.slice(1));
    return route.fulfill({
      json: { place: { name: "Carlton", label: "Carlton, Victoria 3053, Australia" } },
      headers: { "cache-control": "no-store" },
    });
  });
  await page.route("**/api/venues?**", (route) =>
    route.fulfill({ json: { items: [], totalCount: 0, nextCursor: null } }),
  );
  return reverse;
}

/** Counts getCurrentPosition calls, and optionally makes the browser report a permission or failure. */
async function instrument(context: BrowserContext, options: { permission?: PermissionState; errorCode?: number } = {}) {
  await context.addInitScript((opts) => {
    const w = window as unknown as { __geoCalls: number };
    w.__geoCalls = 0;
    const geo = navigator.geolocation as Geolocation | undefined;
    if (geo === undefined) return;
    const original = geo.getCurrentPosition.bind(geo);
    geo.getCurrentPosition = (ok, fail, positionOptions) => {
      w.__geoCalls += 1;
      if (opts.errorCode !== undefined) {
        const code = opts.errorCode;
        setTimeout(() => fail?.({ code, message: "test" } as GeolocationPositionError), 10);
        return;
      }
      original(ok, fail, positionOptions);
    };
    if (opts.permission !== undefined) {
      const state = opts.permission;
      navigator.permissions.query = () => Promise.resolve({ state, onchange: null } as unknown as PermissionStatus);
    }
  }, options);
}

const geoCalls = (page: Page) => page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls);
const useMyLocation = (page: Page) => page.getByRole("button", { name: "Use my location" });

test.describe("Use my location", () => {
  test("access already granted: the landing page fills in the nearby place by itself", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(PRECISE);
    await instrument(context);
    const reverse = await mockApis(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Soccer fields near Carlton, Victoria 3053");
    // Only the rounded position ever leaves the browser: the lookup and the URL.
    expect(reverse).toEqual(["lat=-37.80&lng=144.97"]);
    const url = new URL(page.url());
    expect(url.searchParams.get("lat")).toBe("-37.8");
    expect(url.searchParams.get("lng")).toBe("144.97");
    expect(page.url()).not.toMatch(/801234|966789/);
    await expect(page.getByRole("search").getByRole("combobox")).toHaveValue("Carlton, Victoria 3053");
    // It replaced the empty landing page rather than adding a history entry.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/\?$|\/$/);
  });

  test("not decided yet: nothing is read on load, and the button asks", async ({ page, context }) => {
    await instrument(context, { permission: "prompt" });
    await mockApis(page);
    await page.goto("/");
    await expect(useMyLocation(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(await geoCalls(page)).toBe(0);
    await expect(page).toHaveURL(/\/$/);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("a place the person already chose is never replaced", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(PRECISE);
    await instrument(context);
    await mockApis(page);
    const chosen = "/?lat=-37.767&lng=144.962&place=Brunswick";
    await page.goto(chosen);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Soccer fields near Brunswick");
    await page.waitForTimeout(500);
    expect(await geoCalls(page)).toBe(0);
    await expect(page).toHaveURL(chosen);
  });

  test("pressing the button above the results searches near the person", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(PRECISE);
    await instrument(context);
    await mockApis(page);
    await page.goto("/?lat=-37.767&lng=144.962&place=Brunswick&surface=grass");
    await useMyLocation(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Soccer fields near Carlton, Victoria 3053");
    expect(new URL(page.url()).searchParams.get("surface")).toBe("grass");
    // A search of its own: Back returns to Brunswick.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Soccer fields near Brunswick");
  });

  for (const [name, errorCode, message] of [
    ["denied", 1, /Location access is off/],
    ["timeout", 3, /Couldn't get your location in time/],
  ] as const) {
    test(`${name}: explains, and manual search still works`, async ({ page, context }) => {
      await instrument(context, { permission: name === "denied" ? "denied" : "prompt", errorCode });
      await mockApis(page);
      await page.goto("/");
      await page.waitForTimeout(300);
      expect(await geoCalls(page)).toBe(0);
      await useMyLocation(page).click();
      await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("search").getByRole("combobox")).toBeEnabled();
    });
  }
});
