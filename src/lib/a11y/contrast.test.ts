import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("contrastRatio", () => {
  it("is 21:1 for black on white and symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  it("is 1:1 for identical colours", () => {
    expect(contrastRatio("#087f45", "#087F45")).toBe(1);
  });

  it("rejects non-#rrggbb input", () => {
    expect(() => relativeLuminance("#fff")).toThrow();
    expect(() => relativeLuminance("green")).toThrow();
  });
});
