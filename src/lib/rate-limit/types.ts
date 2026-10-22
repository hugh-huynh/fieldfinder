import { createHash } from "node:crypto";

// App-level rate limiting (ADR-0004, D5 option B). Public routes are limited at the edge by Vercel
// Firewall; this interface covers what the edge can't express (per admin credential, failed auth).
// Backends: Postgres (./postgres.ts) in the app, in-memory (./memory.ts) in tests. Another store,
// e.g. Upstash, can be added later without touching routes.

export interface RateLimitRule {
  /** Short name used as the bucket prefix, e.g. "admin.auth-failure". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits counted in the current window, including this one. */
  hits: number;
  /** When the current window ends. */
  resetAt: Date;
}

export interface RateLimiter {
  /** Adds `cost` hits (default 1). A cost of 0 only checks whether the bucket is already full. */
  hit(rule: RateLimitRule, subject: string, cost?: number): Promise<RateLimitResult>;
}

/**
 * Bucket key for `subject` under `rule`. The subject (an IP address, a credential id) is hashed, so
 * the store never holds it in clear and its characters can't break the key format.
 */
export function bucketKey(rule: RateLimitRule, subject: string): string {
  return `${rule.name}:${createHash("sha256").update(subject, "utf8").digest("hex")}`;
}

/** Whole seconds until `resetAt`, at least 1: the value for a Retry-After header. */
export function retryAfterSeconds(resetAt: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
}
