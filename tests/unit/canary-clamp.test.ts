import { describe, expect, it } from "vitest";

import { clamp } from "@/lib/canary/clamp";

describe("clamp", () => {
  it("returns max when value is above the range", () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("returns min when value is below the range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it("returns the value unchanged inside the range, including the bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});
