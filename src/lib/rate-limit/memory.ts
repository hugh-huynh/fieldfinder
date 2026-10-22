import { bucketKey, type RateLimiter, type RateLimitResult, type RateLimitRule } from "./types";

// In-memory fixed-window limiter for tests. Same semantics as admin_rate_limit_hit() (migration
// 0005). Not for production: on Vercel every function instance would keep its own counts.

export function createMemoryRateLimiter(now: () => Date = () => new Date()): RateLimiter {
  const windows = new Map<string, { start: number; hits: number }>();

  return {
    hit(rule: RateLimitRule, subject: string, cost = 1): Promise<RateLimitResult> {
      const windowMs = rule.windowSeconds * 1000;
      const start = Math.floor(now().getTime() / windowMs) * windowMs;
      const key = bucketKey(rule, subject);
      const current = windows.get(key);
      const hits = (current?.start === start ? current.hits : 0) + cost;
      if (cost > 0) windows.set(key, { start, hits });
      return Promise.resolve({
        allowed: cost === 0 ? hits < rule.limit : hits <= rule.limit,
        hits,
        resetAt: new Date(start + windowMs),
      });
    },
  };
}
