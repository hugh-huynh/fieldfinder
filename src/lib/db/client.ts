import "server-only";

import postgres from "postgres";

import { databaseUrl, type DbRole } from "@/lib/env";

export type Sql = postgres.Sql;

/** postgres.js options per role (ADR-0002). Exported for tests. */
export function connectionOptions(role: DbRole): postgres.Options<Record<string, never>> {
  return {
    // Supavisor transaction pooling can't keep prepared statements between transactions.
    prepare: false,
    // Serverless functions each hold their own pool; keep them small.
    max: role === "public" ? 5 : 2,
    idle_timeout: 20,
    connect_timeout: 10,
    // Server NOTICEs can echo values; never print them.
    onnotice: () => undefined,
    connection: { application_name: `fieldfinder-${role}` },
  };
}

// One pool per role per server process. Kept on globalThis so dev hot reloads don't leak pools.
const pools = ((globalThis as typeof globalThis & { __ffSqlPools?: Partial<Record<DbRole, Sql>> }).__ffSqlPools ??= {});

/** Lazily created connection pool for `role`. Prefer `publicDb()` / `adminDb()`. */
export function getSql(role: DbRole): Sql {
  return (pools[role] ??= postgres(databaseUrl(role), connectionOptions(role)));
}
