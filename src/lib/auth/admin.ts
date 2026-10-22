import "server-only";

import { timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/api/errors";
import { log as defaultLogger, type Logger } from "@/lib/log";
import { clientSubject } from "@/lib/rate-limit/client-ip";
import { ADMIN_AUTH_FAILURES, ADMIN_CREDENTIAL_REQUESTS } from "@/lib/rate-limit/rules";
import { retryAfterSeconds, type RateLimiter } from "@/lib/rate-limit/types";

import type { CredentialStore } from "./credential-store";
import type { AdminScope } from "./scopes";
import { hashToken, isWellFormedToken, TOKEN_PREFIX } from "./token";

// Admin API authentication (ADR-0003, PR 2.9). Order of checks:
//   1. A credential in the query string → 400. It's already leaked into URLs and logs upstream.
//   2. This client (IPv4 address or IPv6 /64) already has too many failed attempts → 429, before
//      the token is even looked at.
//   3. Missing, malformed, unknown, expired or revoked token, or a client IP outside the allowlist
//      → 401, all with the same body so a caller learns nothing about which check failed.
//      Each of these counts as a failed attempt for the client.
//   4. Too many requests for this credential → 429 with Retry-After.
//   5. Valid credential without the required scope → 403.

export interface AdminPrincipal {
  credentialId: string;
  label: string;
  scopes: readonly string[];
}

export interface AdminAuthDeps {
  store: CredentialStore;
  limiter: RateLimiter;
  /** Trusted client IP (rate-limit/client-ip.ts), or null when unknown. */
  clientIp: string | null;
  now?: () => Date;
  logger?: Logger;
}

/** Query parameter names that look like someone trying to send a credential in the URL. */
const CREDENTIAL_PARAMS = new Set([
  "token",
  "access_token",
  "api_key",
  "apikey",
  "key",
  "auth",
  "authorization",
  "bearer",
]);

// The scheme name is case-insensitive (RFC 9110 §11.1); the token itself is exact.
const BEARER = /^Bearer ([^\s]+)$/i;

function credentialInQuery(url: URL): boolean {
  for (const [name, value] of url.searchParams) {
    if (CREDENTIAL_PARAMS.has(name.toLowerCase()) || value.includes(TOKEN_PREFIX)) return true;
  }
  return false;
}

function rateLimited(resetAt: Date, now: Date): ApiError {
  return new ApiError("rate_limited", undefined, {
    headers: { "retry-after": String(retryAfterSeconds(resetAt, now)) },
  });
}

export async function authenticateAdmin(
  request: Request,
  requiredScope: AdminScope,
  deps: AdminAuthDeps,
): Promise<AdminPrincipal> {
  const now = deps.now ?? (() => new Date());

  if (credentialInQuery(new URL(request.url))) {
    // A distinct event so the operator knows to rotate a token that may have leaked. The URL, the
    // parameter names and the token are never logged.
    (deps.logger ?? defaultLogger).warn("admin.credential_in_url", {});
    throw new ApiError("invalid_request", "Send credentials in the Authorization header, never in the URL.");
  }

  const client = clientSubject(deps.clientIp);
  const failures = await deps.limiter.hit(ADMIN_AUTH_FAILURES, client, 0);
  if (!failures.allowed) throw rateLimited(failures.resetAt, now());

  const fail = async (): Promise<never> => {
    await deps.limiter.hit(ADMIN_AUTH_FAILURES, client);
    throw new ApiError("unauthenticated", undefined, { headers: { "www-authenticate": "Bearer" } });
  };

  const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token === undefined || !isWellFormedToken(token)) return fail();

  const hash = hashToken(token);
  const record = await deps.store.findByTokenHash(hash, deps.clientIp);
  if (
    record === null ||
    // The lookup already matched on the hash; compare again in constant time as ADR-0003 requires.
    record.tokenHash.length !== hash.length ||
    !timingSafeEqual(record.tokenHash, hash) ||
    record.revokedAt !== null ||
    record.expiresAt.getTime() <= now().getTime() ||
    !record.ipAllowed
  ) {
    return fail();
  }

  const usage = await deps.limiter.hit(ADMIN_CREDENTIAL_REQUESTS, record.id);
  if (!usage.allowed) throw rateLimited(usage.resetAt, now());

  if (!record.scopes.includes(requiredScope)) {
    throw new ApiError("forbidden", "This credential doesn't have the required scope.");
  }

  await deps.store.touch(record.id);
  return { credentialId: record.id, label: record.label, scopes: record.scopes };
}
