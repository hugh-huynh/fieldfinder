import type { RateLimitRule } from "./types";

// App-level limits for the admin API (ADR-0004). Starting values, to be tuned against real use.
// Public routes are limited at the edge by Vercel Firewall rules instead (documented in ADR-0004).

/** Failed admin authentications per client IP. Stops token guessing. */
export const ADMIN_AUTH_FAILURES: RateLimitRule = { name: "admin.auth-failure", limit: 10, windowSeconds: 60 };

/** Authenticated admin requests per credential, whatever IP they come from. */
export const ADMIN_CREDENTIAL_REQUESTS: RateLimitRule = { name: "admin.credential", limit: 120, windowSeconds: 60 };
