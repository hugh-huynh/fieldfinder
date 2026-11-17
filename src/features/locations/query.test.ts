import { describe, expect, it } from "vitest";

import { reverseQuery, reverseQuerySchema, suggestQuery, withoutCountry } from "./query";

// The search box asks for suggestions only when the API would accept the query (PR 3.2).

describe("suggestQuery", () => {
  it("normalises like the API", () => {
    expect(suggestQuery("  St   Kilda ")).toBe("St Kilda");
    expect(suggestQuery("Brunswick East, VIC 3057")).toBe("Brunswick East, VIC 3057");
  });

  it.each([
    ["", "empty"],
    ["B", "one character"],
    ["  B  ", "one character after trimming"],
    ["<script>", "symbols"],
    ["x".repeat(81), "over 80 characters"],
  ])("rejects %j (%s)", (input) => {
    expect(suggestQuery(input)).toBeNull();
  });
});

describe("reverseQuery (PR 3.9)", () => {
  it("sends the device's position rounded to 2 dp, never more", () => {
    expect(reverseQuery(-37.801234, 144.966789)).toBe("lat=-37.80&lng=144.97");
    expect(reverseQuery(-0.001, 0.004)).toBe("lat=0.00&lng=0.00");
  });

  it("produces what the API accepts", () => {
    const params = Object.fromEntries(new URLSearchParams(reverseQuery(-37.801234, 144.966789)));
    expect(reverseQuerySchema.parse(params)).toEqual({ lat: -37.8, lng: 144.97 });
  });
});

describe("withoutCountry", () => {
  it("drops the trailing country: every place here is in Australia", () => {
    expect(withoutCountry("Carlton, Victoria 3053, Australia")).toBe("Carlton, Victoria 3053");
    expect(withoutCountry("Melbourne")).toBe("Melbourne");
  });
});
