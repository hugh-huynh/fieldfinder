import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { E2E_GA_MEASUREMENT_ID } from "../../playwright.config";

// GA4 (spec §7, ADR-0005, PR 4.1) in a real browser, against a build with a fake measurement id.
// Nothing reaches Google: every request to its hosts is answered here. gtag.js is replaced by a
// stand-in that does what the real one does with our data layer: it sends a hit per event, taking
// `dl` from page_location and falling back to the browser's real URL (and `dr` to document.referrer)
// when none is set, and sends an automatic page view unless told not to. So a hit with "lat=" in
// it would mean our code let the real URL through.

const SEARCH = "/?lat=-37.784&lng=144.968&place=12+Smith+St%2C+Carlton+North&radiusKm=5";

const GTAG_STAND_IN = `(() => {
  const ID = ${JSON.stringify(E2E_GA_MEASUREMENT_ID)};
  const layer = (window.dataLayer = window.dataLayer || []);
  let config = {};
  const skip = /^(page_location|page_referrer|page_title|send_page_view|allow_.*|cookie_.*)$/;
  function hit(name, params) {
    const p = Object.assign({}, config, params || {});
    const q = new URLSearchParams({
      v: "2", tid: ID, en: name,
      dl: p.page_location || location.href,
      dr: p.page_referrer || document.referrer,
      dt: p.page_title || document.title,
    });
    for (const key of Object.keys(p)) if (!skip.test(key)) q.set("ep." + key, String(p[key]));
    fetch("https://www.google-analytics.com/g/collect?" + q.toString(), { method: "POST", mode: "no-cors", keepalive: true });
  }
  function handle(args) {
    if (window["ga-disable-" + ID] === true) return;
    if (args[0] === "config") {
      config = Object.assign({}, config, args[2]);
      if (!args[2] || args[2].send_page_view !== false) hit("page_view", {});
    }
    if (args[0] === "event") hit(args[1], args[2]);
  }
  for (const args of layer) handle(args);
  const push = layer.push.bind(layer);
  layer.push = (args) => { handle(args); return push(args); };
})();`;

type Hit = { en: string; dl: string; dr: string; params: Record<string, string>; raw: string };

/** Answers every request to Google's analytics hosts, and records what was sent. */
async function interceptGoogle(page: Page) {
  const requests: string[] = [];
  const hits: Hit[] = [];
  await page
    .context()
    .route(/^https:\/\/([^/]*\.)?(googletagmanager|google-analytics|analytics\.google)\.com\//, (route) => {
      const request = route.request();
      requests.push(request.url());
      if (request.url().includes("/gtag/js")) {
        return route.fulfill({ contentType: "text/javascript", body: GTAG_STAND_IN });
      }
      const url = new URL(request.url());
      const params: Record<string, string> = {};
      for (const [key, value] of url.searchParams) if (key.startsWith("ep.")) params[key.slice(3)] = value;
      hits.push({
        en: url.searchParams.get("en") ?? "",
        dl: url.searchParams.get("dl") ?? "",
        dr: url.searchParams.get("dr") ?? "",
        params,
        raw: `${request.url()} ${request.postData() ?? ""}`,
      });
      return route.fulfill({ status: 204 });
    });
  return { requests, hits };
}

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
            location: { latitude: -37.78, longitude: 144.96 },
            access: "public",
            distanceMeters: 1200,
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

const banner = (page: Page) => page.getByRole("region", { name: "Help us improve FieldFinder?" });

/** Nothing anywhere in what was sent may hold the searched place or its coordinates. */
function expectNoLocation(hits: Hit[]) {
  for (const hit of hits) {
    expect(hit.raw).not.toMatch(/lat(%3D|=)|lng(%3D|=)|-37\.78|144\.96|Smith|place(%3D|=)/i);
  }
}

// No choice made yet: the banner shows (playwright.config.ts presets "No thanks" for other specs).
test.use({ storageState: { cookies: [], origins: [] } });

test('nothing goes to Google before a choice, or after "No thanks"', async ({ page }) => {
  const google = await interceptGoogle(page);
  await mockSearch(page);
  await page.goto(SEARCH);
  await expect(banner(page)).toBeVisible();
  await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();

  await banner(page).getByRole("button", { name: "No thanks" }).click();
  await expect(banner(page)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();
  await expect(banner(page)).toBeHidden();
  expect(google.requests).toEqual([]);
});

test('after "Allow": one page view per navigation, and no hit carries the place or coordinates', async ({ page }) => {
  const google = await interceptGoogle(page);
  await mockSearch(page);
  await page.goto(SEARCH);
  await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();
  await banner(page).getByRole("button", { name: "Allow analytics" }).click();
  await expect(banner(page)).toBeHidden();

  const origin = new URL(page.url()).origin;
  await expect
    .poll(() => google.hits.filter((h) => h.en === "page_view").map((h) => h.dl))
    .toEqual([`${origin}/?radiusKm=5`]);
  // The search the person was already looking at isn't sent again: consent came after its results.

  // Two client-side navigations: one page view each.
  await page.getByRole("navigation", { name: "Site information" }).getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await page.getByRole("contentinfo").getByRole("link", { name: "Terms of use" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();

  await expect
    .poll(() => google.hits.filter((h) => h.en === "page_view").map((h) => [h.dl, h.dr]))
    .toEqual([
      [`${origin}/?radiusKm=5`, ""],
      [`${origin}/privacy`, `${origin}/?radiusKm=5`],
      [`${origin}/terms`, `${origin}/privacy`],
      [`${origin}/privacy`, `${origin}/terms`],
    ]);
  // gtag.js was fetched once, and never with the page's URL.
  expect(google.requests.filter((url) => url.includes("/gtag/js"))).toEqual([
    `https://www.googletagmanager.com/gtag/js?id=${E2E_GA_MEASUREMENT_ID}`,
  ]);
  expectNoLocation(google.hits);
});

test("a search sends its kind, radius, filters and count, never the place", async ({ page }) => {
  const google = await interceptGoogle(page);
  await mockSearch(page);
  await page.goto("/privacy");
  await banner(page).getByRole("button", { name: "Allow analytics" }).click();
  await page.goto(SEARCH);
  await expect(page.getByRole("list", { name: "Venues" })).toBeVisible();

  await expect
    .poll(() => google.hits.find((h) => h.en === "search_fields")?.params)
    .toEqual({ search_type: "place", result_count: "1", radius_km: "5", filter_count: "1", filter_types: "radius" });
  expectNoLocation(google.hits);
});

test("turning analytics off on /privacy stops it at once", async ({ page }) => {
  const google = await interceptGoogle(page);
  await page.goto("/privacy");
  await banner(page).getByRole("button", { name: "Allow analytics" }).click();
  await expect.poll(() => google.hits.length).toBe(1);

  const choice = page.getByRole("group", { name: "Google Analytics in this browser" });
  await expect(choice.getByRole("radio", { name: "Allow analytics" })).toBeChecked();
  await choice.getByRole("radio", { name: "Don’t allow" }).check();
  await expect(page.getByRole("status").filter({ hasText: "Analytics is off" })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/_ga/);

  await page.getByRole("contentinfo").getByRole("link", { name: "Terms of use" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
  // Give a page view time to (not) arrive.
  await page.waitForTimeout(500);
  expect(google.hits.map((h) => h.en)).toEqual(["page_view"]);
});

test("the banner has no serious accessibility problems and covers nothing", async ({ page }) => {
  await mockSearch(page);
  await page.goto(SEARCH);
  await expect(banner(page)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include("body > section")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  // In the page's flow above the header: the header starts where the banner ends.
  const bannerBox = await banner(page).boundingBox();
  const headerBox = await page.getByRole("banner").boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(headerBox?.y).toBeGreaterThanOrEqual((bannerBox?.y ?? 0) + (bannerBox?.height ?? 0) - 1);
  // The search page still fits the screen: the layout makes room rather than running off the bottom.
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeInViewport();
});

test.describe("detail pages (local database)", () => {
  test.skip(process.env.E2E_DB !== "1", "needs the local database: pnpm db:start, then E2E_DB=1 pnpm e2e");

  test("a venue opened from the list sends view_venue from the list, and directions are counted", async ({
    page,
    context,
  }) => {
    const google = await interceptGoogle(page);
    // "Get directions" opens Google Maps in a new tab: answered here, never fetched.
    await context.route("https://www.google.com/maps/**", (route) => route.fulfill({ body: "maps" }));
    await page.goto("/privacy");
    await banner(page).getByRole("button", { name: "Allow analytics" }).click();
    await page.goto("/?lat=-37.784&lng=144.968&place=Carlton+North%2C+Victoria+3054");
    await page.getByRole("list", { name: "Venues" }).getByRole("link", { name: "Ironbark Park" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ironbark Park" })).toBeVisible();

    const origin = new URL(page.url()).origin;
    await expect
      .poll(() => google.hits.filter((h) => h.en === "view_venue").map((h) => [h.dl, h.params.source]))
      .toEqual([[`${origin}/venues/ironbark-park`, "list"]]);
    const names = google.hits.map((h) => h.en);
    expect(names.lastIndexOf("page_view")).toBeLessThan(names.indexOf("view_venue"));

    const popup = context.waitForEvent("page");
    await page.getByRole("link", { name: /Get directions/ }).click();
    await (await popup).close();
    await expect.poll(() => google.hits.filter((h) => h.en === "click_directions").length).toBe(1);
    expectNoLocation(google.hits);
  });
});
