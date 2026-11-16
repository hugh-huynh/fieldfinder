import { describe, expect, it } from "vitest";

import { suggestQuery } from "./query";

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
