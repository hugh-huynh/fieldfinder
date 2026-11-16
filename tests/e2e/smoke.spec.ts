import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("smoke @smoke", () => {
  test("home page renders the brand and has no serious accessibility violations", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("banner").getByRole("link", { name: "FieldFinder" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("responses carry the baseline security headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("geolocation=(self)");
    expect(headers["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
