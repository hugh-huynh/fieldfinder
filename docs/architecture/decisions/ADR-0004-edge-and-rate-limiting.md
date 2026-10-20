# ADR-0004: Edge protection and rate limiting

- Status: Accepted (2026-10-11; D5, D7, D8, D9). App limiter store revised 2026-10-20 (D5 option B, see below).
- Context: Spec §2/§6 want WAF/rate limiting plus a shared-store app limiter, with trusted client-IP handling. Vercel discourages third-party reverse proxies in front of it.

## Decision

- Edge: Vercel Firewall (custom/WAF and rate-limit rules). Cloudflare, if used, is DNS-only.
- App: limits the edge can't express, behind one interface (`src/lib/rate-limit/`). **Revised 2026-10-20 (D5 option B): no Upstash.**
  - Admin routes: a Postgres-backed fixed-window limiter (`admin_rate_limit_hit()`, migration 0005), counting per credential and failed authentications per client (IPv4 address or IPv6 /64). Admin traffic is tiny, so one upsert per check is cheap. Bucket keys hash the subject, so no raw IP is stored.
  - Public routes: limited at the edge only (rules below). Blocked requests never reach a function or the database.
  - In-memory backend for tests. Another store (e.g. Upstash) can be added later without route changes.
- Client IP comes from Vercel-set headers only; `X-Forwarded-For` from clients is never trusted.
- Limiter keys are normalised so query-string variation cannot bypass limits.
- Search is bounded: radius ≤ 50 km, limit ≤ 30, HMAC-signed cursors bound to the query; map markers show loaded results only ("Show more venues").
- `GET /api/venues` returns a bounded `totalCount`; a count endpoint backs the filter dialog preview.
- Sitemap includes published venue and pitch URLs (accepted enumeration trade-off; published pages are public anyway).
- Initial thresholds (e.g. 60 req/min/IP) are hypotheses, tuned against real traffic.

## Vercel Firewall rules (applied by Hugh in ticket 4.3)

Rate-limit rules in Project → Firewall, keyed on client IP, fixed 60 s window. Starting hypotheses:

| Rule                    | Path condition                | Limit / 60 s / IP | Action           |
| ----------------------- | ----------------------------- | ----------------- | ---------------- |
| Search                  | `/api/venues` (exact)         | 60                | Rate limit (429) |
| Detail                  | starts with `/api/venues/`    | 120               | Rate limit (429) |
| Location suggest (2.13) | starts with `/api/locations/` | 30                | Rate limit (429) |
| Admin                   | starts with `/api/admin/`     | 60                | Rate limit (429) |

Pro allows up to 40 rules per project, keyed on IP or JA4, windows 10 s–10 min. Counters are per edge region, so a client spread across regions can exceed a limit in total; the app-level admin limiter is global.

## Consequences

- Cloudflare Access is not available for admin (see ADR-0003).
- Requires Vercel Pro for Firewall rate-limit rules. No Upstash account (revised 2026-10-20).
