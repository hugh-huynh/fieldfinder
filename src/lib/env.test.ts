import { describe, expect, it } from "vitest";

import { searchCursorSecret } from "./env";

describe("searchCursorSecret", () => {
  it("returns a key of at least 32 bytes", () => {
    const key = "k".repeat(32);
    expect(searchCursorSecret({ SEARCH_CURSOR_SECRET: key })).toBe(key);
  });

  it.each([undefined, "", "short-but-not-empty", "k".repeat(31)])("rejects %j without echoing it", (value) => {
    expect(() => searchCursorSecret({ SEARCH_CURSOR_SECRET: value })).toThrow(
      new Error("SEARCH_CURSOR_SECRET is missing or shorter than 32 bytes"),
    );
  });
});
