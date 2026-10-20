import { describe, expect, it } from "vitest";

import { slugSchema } from "./slug";

const parse = (value: unknown) => slugSchema.safeParse(value);

describe("slugSchema", () => {
  it("accepts the slug format", () => {
    expect(parse("wattlebird-reserve").data).toBe("wattlebird-reserve");
    expect(parse("pitch-1").data).toBe("pitch-1");
    expect(parse("a".repeat(100)).success).toBe(true);
  });

  it("treats a lowercase uuid as an ordinary slug", () => {
    expect(parse("5eed0000-0000-4000-8000-000000000001").data).toBe("5eed0000-0000-4000-8000-000000000001");
  });

  it.each([
    ["empty", ""],
    ["uppercase", "Wattlebird-Reserve"],
    ["uppercase uuid", "5EED0000-0000-4000-8000-000000000001"],
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
