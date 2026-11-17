import { describe, expect, it } from "vitest";

import { clampSheet, nearestSnap, snapHeight, snapHeights, stepSnap } from "./sheet";

// Snap points for the mobile results sheet (PR 3.8).

describe("snapHeights", () => {
  it("peeks, splits and leaves a strip of map, on a phone (390×844 minus the 128 px header)", () => {
    expect(snapHeights(716)).toEqual({ map: 132, balanced: 358, list: 620 });
  });

  it("keeps a strip of at least 96 px of map, and 12% on a tall screen", () => {
    expect(snapHeight("list", 1000)).toBe(880);
    expect(snapHeight("list", 600)).toBe(504);
  });

  it("stays in order on a very short screen", () => {
    const { map, balanced, list } = snapHeights(200);
    expect(map).toBeLessThanOrEqual(balanced);
    expect(balanced).toBeLessThanOrEqual(list);
    expect(list).toBe(104);
  });
});

describe("nearestSnap", () => {
  it("settles a released drag on the closest snap", () => {
    expect(nearestSnap(150, 716)).toBe("map");
    expect(nearestSnap(300, 716)).toBe("balanced");
    expect(nearestSnap(500, 716)).toBe("list");
    expect(nearestSnap(9999, 716)).toBe("list");
  });
});

describe("stepSnap", () => {
  it("moves one step and stops at the ends", () => {
    expect(stepSnap("map", 1)).toBe("balanced");
    expect(stepSnap("balanced", 1)).toBe("list");
    expect(stepSnap("list", 1)).toBe("list");
    expect(stepSnap("balanced", -1)).toBe("map");
    expect(stepSnap("map", -1)).toBe("map");
  });
});

describe("clampSheet", () => {
  it("keeps a drag between the smallest and largest snap", () => {
    expect(clampSheet(10, 716)).toBe(132);
    expect(clampSheet(400, 716)).toBe(400);
    expect(clampSheet(700, 716)).toBe(620);
  });
});
