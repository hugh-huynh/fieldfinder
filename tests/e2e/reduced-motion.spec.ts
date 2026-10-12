import { expect, test } from "@playwright/test";

const seconds = (cssTime: string) => parseFloat(cssTime);

// Probe an element styled like <Skeleton> (Tailwind `animate-pulse`, an infinite animation)
// and a `transition-colors` control, using the app's real stylesheet.
async function probeMotion(page: import("@playwright/test").Page) {
  await page.goto("/");
  return page.evaluate(() => {
    const pulse = document.createElement("div");
    pulse.className = "animate-pulse";
    const button = document.createElement("button");
    button.className = "transition-colors";
    document.body.append(pulse, button);
    const p = getComputedStyle(pulse);
    const b = getComputedStyle(button);
    return {
      animationDuration: p.animationDuration,
      animationIterationCount: p.animationIterationCount,
      transitionDuration: b.transitionDuration,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });
}

test.describe("prefers-reduced-motion @smoke", () => {
  test.describe("when the user asks for reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("animations collapse to a single near-instant run and transitions are near-instant", async ({ page }) => {
      const motion = await probeMotion(page);

      expect(seconds(motion.animationDuration)).toBeLessThan(0.001);
      // An infinite animation at 0.01ms would restart every frame and flicker.
      expect(motion.animationIterationCount).toBe("1");
      expect(seconds(motion.transitionDuration)).toBeLessThan(0.001);
      expect(motion.scrollBehavior).toBe("auto");
    });
  });

  test.describe("when the user has no motion preference", () => {
    test.use({ reducedMotion: "no-preference" });

    test("animations keep their normal timing", async ({ page }) => {
      const motion = await probeMotion(page);

      expect(seconds(motion.animationDuration)).toBe(2);
      expect(motion.animationIterationCount).toBe("infinite");
    });
  });
});
