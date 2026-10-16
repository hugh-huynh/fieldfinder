import "server-only";

import { z } from "zod";

// Server-only configuration. Values are read lazily so `next build` works without database
// credentials, and errors name the variable but never echo its value (it contains a password).

const DATABASE_URL_VARS = {
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
