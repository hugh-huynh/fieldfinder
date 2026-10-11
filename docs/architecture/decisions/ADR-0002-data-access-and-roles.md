# ADR-0002: Data access layer and database roles

- Status: Accepted (2026-10-11; D2, D11, D18)
- Context: Spec §4 requires server-only privileged access, no anonymous access to master tables, and published-only public reads.

## Decision

- Access Postgres directly from server code with `postgres` (postgres.js) and hand-written SQL in `src/lib/db/`; parse rows with Zod. No supabase-js data client.
- Two application roles:
  - `ff_public_reader`: `SELECT` only on published views (`public_venues_v`, `public_pitches_v`, `public_media_v`) and `search_venues(...)`. No base-table access.
  - `ff_admin_writer`: used only by authenticated admin routes.
- RLS enabled on every base table with no policies for `anon`/`authenticated`; Supabase Data API grants revoked, so the anon key is useless against master data.
- Connect through Supavisor transaction pooling with prepared statements disabled.
- Pitch access filter uses effective access `COALESCE(pitch.access, venue.access)`.
- Slugs are immutable after first publish (redirect table is out of MVP).
- Single authoritative publication state per entity (`draft | published | archived`); `field_publications` keeps history.

## Consequences

- Public DTOs are built from views, so a missing grant fails closed.
- Integration tests assert permission-denied for the reader role on base tables.
