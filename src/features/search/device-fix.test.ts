import { describe, expect, it } from "vitest";

import { isNearFix } from "./device-fix";

// "Near me" means the search's location is the device fix rounded to 2 dp (PR 3.9).

describe("isNearFix", () => {
  const fix = { lat: -37.80123, lng: 144.96789 };

  it("is true when the search is at the rounded fix", () => {
    expect(isNearFix({ lat: -37.8, lng: 144.97, label: "Carlton" }, fix)).toBe(true);
  });

  it("is false for another place, no place, or no fix", () => {
    expect(isNearFix({ lat: -37.81, lng: 144.97, label: null }, fix)).toBe(false);
    expect(isNearFix({ lat: -37.814, lng: 144.963, label: "Melbourne" }, fix)).toBe(false);
    expect(isNearFix(null, fix)).toBe(false);
    expect(isNearFix({ lat: -37.8, lng: 144.97, label: null }, null)).toBe(false);
  });
});
