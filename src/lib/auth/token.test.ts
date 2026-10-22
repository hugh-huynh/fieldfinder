import { describe, expect, it } from "vitest";

import { ADMIN_SCOPES, isAdminScope } from "./scopes";
import { generateToken, hashToken, isWellFormedToken, TOKEN_PREFIX } from "./token";

describe("admin tokens", () => {
  it("are prefixed, 49 characters, URL-safe and unique", () => {
    const tokens = Array.from({ length: 200 }, generateToken);
    for (const token of tokens) {
      expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
      expect(token).toHaveLength(49);
      expect(isWellFormedToken(token)).toBe(true);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it.each([
    "",
    "ffadm_",
    "ffadm_short",
    `ffadm_${"a".repeat(44)}`,
    `FFADM_${"a".repeat(43)}`,
    `ffadm_${"a".repeat(42)}=`,
  ])("rejects %j as malformed", (value) => {
    expect(isWellFormedToken(value)).toBe(false);
  });

  it("hash to 32 bytes of SHA-256, deterministically", () => {
    const token = generateToken();
    expect(hashToken(token)).toHaveLength(32);
    expect(hashToken(token).equals(hashToken(token))).toBe(true);
    expect(hashToken(token).equals(hashToken(generateToken()))).toBe(false);
    expect(hashToken("abc").toString("hex")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("admin scopes", () => {
  it("all satisfy the format CHECK in migration 0002", () => {
    for (const scope of ADMIN_SCOPES) expect(scope).toMatch(/^[a-z]+(:[a-z]+)?$/);
  });

  it("recognises only the defined scopes", () => {
    expect(isAdminScope("venues:write")).toBe(true);
    expect(isAdminScope("venues:read")).toBe(false);
    expect(isAdminScope("admin")).toBe(false);
  });
});
