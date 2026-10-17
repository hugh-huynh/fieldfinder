import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Opaque, signed keyset cursor for GET /api/venues (PR 2.7, geo-engineer skill).
//
//   cursor = base64url(payload JSON) "." base64url(HMAC-SHA256(secret, domain ‖ payload ‖ query key))
//
// The payload holds the last row's (distance_m, venue_id) keyset position and how many rows were
// already returned. The MAC also covers the canonical search key, so a cursor is only valid for the
// exact search that produced it: editing it, or replaying it with other filters or another centre,
// fails verification. The payload isn't secret (a distance and a public venue id); it's only signed.

const DOMAIN = "fieldfinder.search-cursor.v1";

export interface CursorPosition {
  /** distance_m of the last row returned, exactly as Postgres produced it. */
  distanceM: number;
  /** venue id of the last row returned (tie-breaker). */
  venueId: string;
  /** Rows returned so far, across all pages; used to tell whether another page exists. */
  returned: number;
}

const payloadSchema = z
  .object({
    d: z.number().min(0).max(100_000),
    id: z.uuid(),
    n: z.number().int().min(1).max(100_000),
  })
  .strict();

function mac(secret: string, payload: string, searchKey: string): Buffer {
  return createHmac("sha256", secret).update(`${DOMAIN}\n${payload}\n${searchKey}`).digest();
}

export function encodeCursor(position: CursorPosition, searchKey: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ d: position.distanceM, id: position.venueId, n: position.returned }),
  ).toString("base64url");
  return `${payload}.${mac(secret, payload, searchKey).toString("base64url")}`;
}

/** Returns the position, or null if the cursor is malformed, tampered with or for another search. */
export function decodeCursor(cursor: string, searchKey: string, secret: string): CursorPosition | null {
  const parts = cursor.split(".");
  if (parts.length !== 2) return null;
  const [payload = "", signature = ""] = parts;

  // Compare the encoded text, not decoded bytes: base64url decoding ignores stray characters and
  // spare trailing bits, so different strings could otherwise verify as the same signature.
  const given = Buffer.from(signature, "utf8");
  const expected = Buffer.from(mac(secret, payload, searchKey).toString("base64url"), "utf8");
  // Length check first: timingSafeEqual throws on unequal lengths.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  return { distanceM: parsed.data.d, venueId: parsed.data.id, returned: parsed.data.n };
}
