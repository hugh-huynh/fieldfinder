# ADR-0003: Admin API authentication

- Status: Accepted (2026-10-11; D4)
- Context: Spec §5 prefers Cloudflare Access/OIDC; ADR-0004 keeps Cloudflare out of the request path, so Access is unavailable for MVP.

## Decision

- Admin routes accept `Authorization: Bearer <token>` only. Tokens are ≥ 256-bit random, shown once at creation.
- Stored as SHA-256 hashes in `admin_api_credentials` with `scopes[]`, `expires_at`, `revoked_at`, `last_used_at`, optional IP allowlist. Constant-time comparison.
- Minted, rotated and revoked by an operator CLI (`scripts/admin-credential.ts`), never via a web UI.
- No cookies → CSRF not applicable. Tokens in a query string are rejected (400) and never logged.
- Every admin request is rate limited and every mutation writes `field_revisions`.

## Consequences

- Upgrade path: if Cloudflare later fronts the domain, add Cloudflare Access service tokens in front of `/api/admin/*`.
- Token loss requires rotation via CLI; expiry forces periodic rotation.
