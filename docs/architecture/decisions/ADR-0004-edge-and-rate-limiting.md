# ADR-0004: Edge protection and rate limiting

- Status: Accepted (2026-10-11; D5, D7, D8, D9)
- Context: Spec §2/§6 want WAF/rate limiting plus a shared-store app limiter, with trusted client-IP handling. Vercel discourages third-party reverse proxies in front of it.

## Decision

- Edge: Vercel Firewall (custom/WAF and rate-limit rules). Cloudflare, if used, is DNS-only.
- App: `@upstash/ratelimit` on Upstash Redis, per route + client IP (+ credential for admin). In-memory adapter for tests.
- Client IP comes from Vercel-set headers only; `X-Forwarded-For` from clients is never trusted.
- Limiter keys are normalised so query-string variation cannot bypass limits.
- Search is bounded: radius ≤ 50 km, limit ≤ 30, HMAC-signed cursors bound to the query; map markers show loaded results only ("Show more venues").
- `GET /api/venues` returns a bounded `totalCount`; a count endpoint backs the filter dialog preview.
- Sitemap includes published venue and pitch URLs (accepted enumeration trade-off; published pages are public anyway).
- Initial thresholds (e.g. 60 req/min/IP) are hypotheses, tuned against real traffic.

## Consequences

- Cloudflare Access is not available for admin (see ADR-0003).
- Requires an Upstash account and Vercel Pro for Firewall rate-limit rules.
