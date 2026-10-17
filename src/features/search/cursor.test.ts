import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor, type CursorPosition } from "./cursor";

const SECRET = "unit-test-secret-unit-test-secret-0123";
const KEY = '["v1",-37.814,144.963,10,null,null,null,null,[]]';
const POSITION: CursorPosition = {
  // A full-precision double, as ST_Distance returns it.
  distanceM: Math.PI * 1086.2,
  venueId: "5eed0000-0000-4000-8000-000000000001",
  returned: 3,
};

describe("search cursor", () => {
  it("round-trips the exact keyset position", () => {
    const cursor = encodeCursor(POSITION, KEY, SECRET);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, KEY, SECRET)).toEqual(POSITION);
  });

  it("is rejected for another search, or under another secret", () => {
    const cursor = encodeCursor(POSITION, KEY, SECRET);
    expect(decodeCursor(cursor, KEY.replace("10", "11"), SECRET)).toBeNull();
    expect(decodeCursor(cursor, KEY, `${SECRET}-rotated`)).toBeNull();
  });

  it("rejects any single-character change", () => {
    const cursor = encodeCursor(POSITION, KEY, SECRET);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < cursor.length; i++) {
      if (cursor[i] === ".") continue;
      const replacement = alphabet[(alphabet.indexOf(cursor[i] ?? "A") + 1) % alphabet.length] ?? "A";
      const changed = cursor.slice(0, i) + replacement + cursor.slice(i + 1);
      expect(decodeCursor(changed, KEY, SECRET), `position ${String(i)}`).toBeNull();
    }
  });

  it("rejects a re-signed payload that fails validation", () => {
    // Even with the secret, a payload outside the schema is refused.
    const bad = encodeCursor({ ...POSITION, venueId: "not-a-uuid" }, KEY, SECRET);
    expect(decodeCursor(bad, KEY, SECRET)).toBeNull();
    const negative = encodeCursor({ ...POSITION, distanceM: -1 }, KEY, SECRET);
    expect(decodeCursor(negative, KEY, SECRET)).toBeNull();
  });

  it.each(["", ".", "abc", "a.b.c", "!!!.???", `${"a".repeat(40)}.`])("rejects malformed cursor %j", (cursor) => {
    expect(decodeCursor(cursor, KEY, SECRET)).toBeNull();
  });
});
