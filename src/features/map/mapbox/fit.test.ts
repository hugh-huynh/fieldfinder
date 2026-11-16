import { describe, expect, it } from "vitest";

import { fitPadding } from "./fit";

// Fitting a search's area clear of what covers the map, without padding the map away (3.8).

const none = { top: 0, bottom: 0, left: 0, right: 0 };

describe("fitPadding", () => {
  it("keeps the full room around the area when the map has space for it", () => {
    expect(fitPadding(none, 800, 600)).toEqual({ top: 48, bottom: 48, left: 48, right: 48 });
    expect(fitPadding({ top: 128, bottom: 0, left: 0, right: 64 }, 800, 600)).toEqual({
      top: 176,
      bottom: 48,
      left: 48,
      right: 112,
    });
  });

  it("gives up the room around the area first when only a strip is uncovered", () => {
    // 390×844 phone, list-focused sheet: 716 px of map, 620 px covered, 96 px showing.
    expect(fitPadding({ top: 0, bottom: 620, left: 0, right: 0 }, 390, 716)).toEqual({
      top: 24,
      bottom: 644,
      left: 48,
      right: 48,
    });
  });

  it("shrinks the covered part too when even that leaves no room", () => {
    const { top, bottom } = fitPadding({ top: 100, bottom: 700, left: 0, right: 0 }, 390, 716);
    expect(top + bottom).toBeCloseTo(716 - 48, 6);
    expect(bottom / top).toBeCloseTo(7, 6);
  });

  it("doesn't clamp before the map has a size", () => {
    expect(fitPadding({ top: 0, bottom: 620, left: 0, right: 0 }, 0, 0)).toEqual({
      top: 48,
      bottom: 668,
      left: 48,
      right: 48,
    });
  });
});
