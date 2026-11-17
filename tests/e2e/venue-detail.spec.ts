import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// `/venues/[venueSlug]` (PR 3.10) against the LOCAL seeded database (synthetic venues from
// tests/fixtures/venues.ts). Needs `pnpm db:start` and E2E_DB=1; skipped otherwise (CI's smoke job
// has no database). Every private record in the seed carries PRIVATE_SENTINEL in its name.

const PRIVATE_SENTINEL = "ff-private-sentinel";

test.skip(process.env.E2E_DB !== "1", "needs the local database: pnpm db:start, then E2E_DB=1 pnpm e2e");

test.describe("venue page", () => {
  test("a deep link renders the venue, its published pitches, facilities and directions", async ({ page }) => {
    const response = await page.goto("/venues/ironbark-park");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Ironbark Park, Fitzroy North · FieldFinder");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ironbark Park");

    const pitches = page.getByRole("region", { name: "Pitches" });
    await expect(pitches.getByRole("heading", { level: 3 })).toHaveText(["Pitch A", "Pitch B", "Pitch C", "Pitch D"]);
    await expect(pitches.getByRole("link", { name: "Pitch C" })).toHaveAttribute(
      "href",
      "/venues/ironbark-park/pitches/pitch-c",
    );
    // A pitch's own access rule shows on its card.
    await expect(pitches.getByRole("article").filter({ hasText: "Pitch C" })).toContainText("Members only");

    const facilities = page.getByRole("region", { name: "Facilities" });
    await expect(facilities).toContainText("ToiletsYes");
    await expect(facilities).toContainText("ParkingNot confirmed");
    await expect(facilities).toContainText("CaféNo");

    await expect(page.getByRole("link", { name: /Get directions/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=-37.781%2C144.986",
    );

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  for (const [venueSlug, hiddenPitch] of [
    ["saltbush-sports-park", "Old Pitch"],
    ["banksias-corner-reserve", "Draft Pitch"],
  ] as const) {
    test(`the HTML for ${venueSlug} has nothing unpublished in it`, async ({ request }) => {
      const response = await request.get(`/venues/${venueSlug}`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).not.toContain(PRIVATE_SENTINEL);
      expect(html).not.toContain(hiddenPitch);
      // Nor any other venue's private record (the whole page, including the RSC payload).
      expect(html).not.toContain("Hidden Draft Park");
    });
  }

  for (const [why, venueSlug] of [
    ["a draft venue", "hidden-draft-park"],
    ["an archived venue", "old-mill-oval"],
    ["a venue with no published pitch", "lilly-pilly-fields"],
    ["a venue that doesn't exist", "no-such-venue"],
    ["a malformed slug", "Not%20A%20Slug!"],
  ] as const) {
    test(`${why} is the 404 page, giving nothing away`, async ({ page }) => {
      const response = await page.goto(`/venues/${venueSlug}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't find that page");
      const html = (await response?.text()) ?? "";
      expect(html).not.toContain(PRIVATE_SENTINEL);
      expect(html).not.toContain("Hidden Draft Park");
      expect(html).not.toContain("Old Mill Oval");
      expect(html).not.toContain("Lilly Pilly");
    });
  }

  test("the back link returns to the search the person came from", async ({ page }) => {
    await page.route("**/api/venues?**", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "5eed0000-0000-4000-8000-000000000002",
              slug: "ironbark-park",
              name: "Ironbark Park",
              suburb: "Fitzroy North",
              state: "VIC",
              location: { latitude: -37.781, longitude: 144.986 },
              access: "public",
              distanceMeters: 2100,
              publishedPitchCount: 4,
              matchingPitchCount: 4,
              href: "/venues/ironbark-park",
              amenities: {},
              image: null,
              pitchSummary: { surfaces: [], formats: [], floodlights: null },
            },
          ],
          totalCount: 1,
          nextCursor: null,
        },
      }),
    );
    const search = "/?lat=-37.814&lng=144.963&place=Melbourne&surface=grass";
    await page.goto(search);
    await page.getByRole("list", { name: "Venues" }).getByRole("link", { name: "Ironbark Park" }).click();
    await expect(page).toHaveURL(/\/venues\/ironbark-park$/);
    await page.getByRole("link", { name: "Back to results" }).click();
    await expect(page).toHaveURL(search);
  });
});
