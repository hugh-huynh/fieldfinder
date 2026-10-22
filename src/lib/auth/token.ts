import { createHash, randomBytes } from "node:crypto";

// Admin bearer tokens (ADR-0003). No `server-only` import: scripts/admin-credential.ts runs this
// under plain Node to mint tokens. Nothing here is secret; the tokens it produces are.
//
// Format: "ffadm_" + base64url(32 random bytes) = 49 characters, 256 bits of entropy. The prefix
// makes a leaked token easy to recognise, e.g. in a query string or by a secret scanner.

export const TOKEN_PREFIX = "ffadm_";
const TOKEN_PATTERN = /^ffadm_[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function isWellFormedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** SHA-256 of the token, as stored in admin_api_credentials.token_hash. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
