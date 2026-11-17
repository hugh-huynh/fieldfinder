import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Detail-page photos (PR 3.12) against the LOCAL seeded database: layout shift and the lightbox.
// Needs `pnpm db:start` and E2E_DB=1; the global setup puts the seed's synthetic placeholder photos
// in local storage. Photo requests are delayed here (or failed, to check the fallback).

test.skip(process.env.E2E_DB !== "1", "needs the local database: pnpm db:start, then E2E_DB=1 pnpm e2e");

/**
 * Holds back every photo request (optimised through /_next/image, or straight from the bucket), so a
 * page that didn't reserve the space would visibly shift when they arrive; or fails them all.
 */
async function servePhotos(page: Page, { fail = false, delayMs = 300 } = {}) {
  await page.route(/\/_next\/image\?|\/media-public\//, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    if (fail) await route.fulfill({ status: 404, body: "" });
    else await route.continue();
  });
}

/** Cumulative Layout Shift as Lighthouse counts it: shifts not caused by the person's input. */
async function watchLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

const cls = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

test.describe("detail page photos", () => {
  for (const [name, path] of [
    ["venue page", "/venues/ironbark-park"],
    ["pitch page", "/venues/wattlebird-reserve/pitches/main-pitch"],
  ] as const) {
    for (const fail of [false, true]) {
      test(`${name}: layout shift stays under 0.1 ${fail ? "when photos fail to load" : "as photos load"}`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName !== "chromium", "only Chromium reports layout shifts (as Lighthouse does)");
        await watchLayoutShift(page);
        await servePhotos(page, { fail });
        await page.goto(path);
        await expect(page.getByRole("region", { name: /^Photos of/ })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
        expect(await cls(page)).toBeLessThan(0.1);
        if (fail) await expect(page.getByText("Photo unavailable").first()).toBeAttached();
      });
    }
  }

  test("the lightbox: arrows, Escape, focus kept inside and returned", async ({ page }) => {
    await servePhotos(page, { delayMs: 0 });
    await page.goto("/venues/ironbark-park");
    const second = page.getByRole("button", { name: "Open photo 2 of 2: Goalmouth in afternoon light" });
    await expect(second).toBeVisible();
    // Credits show under photos whose licence needs one.
    await expect(page.getByRole("region", { name: "Photos of Ironbark Park" })).toContainText("Photo:");

    await page.getByRole("button", { name: /Open photo 1 of 2/ }).click();
    const lightbox = page.getByRole("dialog", { name: "Photo 1 of 2" });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByRole("img")).toHaveAccessibleName("Three pitches seen from the pavilion");

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: "Photo 2 of 2" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: "Photo 1 of 2" })).toBeVisible();

    // The page behind is inert: Tab never reaches it.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      const behind = await page.evaluate(() => {
        const active = document.activeElement;
        return active !== null && active !== document.body && active.closest("dialog") === null;
      });
      expect(behind).toBe(false);
    }

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("dialog", { name: "Photo 2 of 2" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(second).toBeFocused();
  });

  test("photos tell the browser how wide they're shown (for srcset)", async ({ page }) => {
    await servePhotos(page, { delayMs: 0 });
    await page.goto("/venues/ironbark-park");
    const sizes = await page
      .getByRole("region", { name: "Photos of Ironbark Park" })
      .getByRole("img")
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("sizes")));
    expect(sizes).toEqual(["(min-width: 1024px) 976px, calc(100vw - 2rem)", "(min-width: 640px) 240px, 33vw"]);
  });
});
