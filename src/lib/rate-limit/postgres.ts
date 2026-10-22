import "server-only";

import { z } from "zod";

import type { Sql } from "@/lib/db/types";

import { bucketKey, type RateLimiter, type RateLimitResult, type RateLimitRule } from "./types";

// Postgres-backed limiter: admin_rate_limit_hit() from migration 0005, called as ff_admin_writer.
// Only the admin API uses it; admin traffic is tiny, so one small upsert per check is cheap.

const resultRow = z.object({ allowed: z.boolean(), hits: z.number().int(), reset_at: z.coerce.date() });

export function createPostgresRateLimiter(sql: Sql): RateLimiter {
  return {
    async hit(rule: RateLimitRule, subject: string, cost = 1): Promise<RateLimitResult> {
      const [row] = await sql`
        select * from public.admin_rate_limit_hit(
          ${bucketKey(rule, subject)}::text,
          ${rule.windowSeconds}::integer,
          ${rule.limit}::integer,
          ${cost}::integer
        )
      `;
      const r = resultRow.parse(row);
      return { allowed: r.allowed, hits: r.hits, resetAt: r.reset_at };
    },
  };
}
