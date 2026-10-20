import "server-only";

import postgres from "postgres";

import { DATABASE_URL_VARS, databaseUrl, type DbRole } from "@/lib/env";

import { tlsOptions } from "./tls";

export type Sql = postgres.Sql;

/** postgres.js options per role (ADR-0002). Exported for tests. */
export function connectionOptions(role: DbRole, url: string): postgres.Options<Record<string, never>> {
  return {
    // TLS for any remote database (./tls.ts).
    ...tlsOptions(url, DATABASE_URL_VARS[role]),
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
  if (pools[role] === undefined) {
    const url = databaseUrl(role);
    pools[role] = postgres(url, connectionOptions(role, url));
  }
  return pools[role];
}
