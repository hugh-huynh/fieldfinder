import { describe, expect, it } from "vitest";

import { identifierSchema } from "./identifier";

const parse = (value: unknown) => identifierSchema.safeParse(value);

describe("identifierSchema", () => {
  it("reads a uuid as an id, normalised to lowercase", () => {
    expect(parse("5EED0000-0000-4000-8000-000000000001").data).toEqual({
      kind: "id",
      id: "5eed0000-0000-4000-8000-000000000001",
    });
  });

  it("reads anything else in slug format as a slug", () => {
    expect(parse("wattlebird-reserve").data).toEqual({ kind: "slug", slug: "wattlebird-reserve" });
    expect(parse("pitch-1").data).toEqual({ kind: "slug", slug: "pitch-1" });
    expect(parse("a".repeat(100)).success).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["uppercase", "Wattlebird-Reserve"],
    ["leading hyphen", "-reserve"],
    ["double hyphen", "wattlebird--reserve"],
    ["space", "wattlebird reserve"],
    ["path traversal", "../admin"],
    ["percent-encoded", "wattlebird%2Freserve"],
    ["SQL", "x' or '1'='1"],
    ["too long", "a".repeat(101)],
    ["not a string", 42],
  ])("rejects %s", (_name, value) => {
    expect(parse(value).success).toBe(false);
  });
});
