import type { AdminOperation } from "@/lib/api/operations";

import type { RateLimitRule } from "./types";

// App-level limits for the admin API (ADR-0004). Starting values, to be tuned against real use.
// Public routes are limited at the edge by Vercel Firewall rules instead (docs/security/edge-rules.md).

/** Failed admin authentications per client IP. Stops token guessing. */
export const ADMIN_AUTH_FAILURES: RateLimitRule = { name: "admin.auth-failure", limit: 10, windowSeconds: 60 };

/** Authenticated admin requests per credential, whatever IP they come from. */
export const ADMIN_CREDENTIAL_REQUESTS: RateLimitRule = { name: "admin.credential", limit: 120, windowSeconds: 60 };

/**
 * Image uploads per credential (PR 4.3). Each one decodes and re-encodes up to 10 MB with sharp, so
 * a leaked or runaway credential could tie up the server well inside the general limit. 30 per
 * 10 minutes is still one every 20 s, ample for adding a venue's photos by hand. Counted before the
 * body is read, so a refused upload (bad type, too large) counts as well.
 */
export const ADMIN_MEDIA_UPLOADS: RateLimitRule = { name: "admin.media-upload", limit: 30, windowSeconds: 600 };

/**
 * Extra per-credential limits for particular admin operations, on top of ADMIN_CREDENTIAL_REQUESTS.
 * Everything else shares the general limit: admin traffic is one operator, and other operations are
 * small database writes.
 */
export const ADMIN_OPERATION_RULES: Partial<Record<AdminOperation, RateLimitRule>> = {
  "admin.media.upload": ADMIN_MEDIA_UPLOADS,
};
