import "server-only";

import { z } from "zod";

// Server-only configuration. Values are read lazily so `next build` works without database
// credentials, and errors name the variable but never echo its value (it contains a password).

/** Variable holding each role's connection string. */
export const DATABASE_URL_VARS = {
  public: "DATABASE_URL_PUBLIC_READER",
  admin: "DATABASE_URL_ADMIN_WRITER",
} as const;

/** Database role a connection runs as (ADR-0002). */
export type DbRole = keyof typeof DATABASE_URL_VARS;

const postgresUrl = z
  .string()
  .refine((value) => /^postgres(ql)?:\/\//.test(value) && URL.canParse(value), "must be a postgres:// URL");

/** Connection string for `role`, validated. Throws without revealing the value. */
export function databaseUrl(role: DbRole, source: Record<string, string | undefined> = process.env): string {
  const name = DATABASE_URL_VARS[role];
  const parsed = postgresUrl.safeParse(source[name]);
  if (!parsed.success) {
    throw new Error(`${name} is missing or is not a postgres:// URL`);
  }
  return parsed.data;
}

/** Name of the variable holding the key that signs search cursors (PR 2.7). */
export const SEARCH_CURSOR_SECRET_VAR = "SEARCH_CURSOR_SECRET";

/**
 * Key for signing search cursors: at least 32 bytes, server-only. Throws without revealing the value.
 * Rotating it only invalidates cursors already handed out (clients restart from page one).
 */
export function searchCursorSecret(source: Record<string, string | undefined> = process.env): string {
  const value = source[SEARCH_CURSOR_SECRET_VAR];
  if (value === undefined || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`${SEARCH_CURSOR_SECRET_VAR} is missing or shorter than 32 bytes`);
  }
  return value;
}
