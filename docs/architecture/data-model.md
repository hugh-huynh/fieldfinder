# Data model

Source of truth: `supabase/migrations/`. This page explains the shape and the rules; if it disagrees with a migration, the migration wins. Spec §4; ADR-0002, ADR-0003, ADR-0006.

## Classification

| Class               | Tables                                                      | Public exposure                                                                 |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Master content      | `venues`, `pitches`, `venue_amenities`, `media_assets`      | Published rows only, through allowlisted views (0003) and DTOs. Never raw rows. |
| Private master      | `field_sources`, `field_verifications`                      | Never.                                                                          |
| Audit (append-only) | `field_revisions`, `field_publications`                     | Never.                                                                          |
| Secret-adjacent     | `admin_api_credentials` (SHA-256 hashes only, never tokens) | Never.                                                                          |

Every table has RLS enabled with no policies, and `anon`/`authenticated` have no privileges. The application connects with its own roles (ADR-0002, migration 0003).

## Relationships

```
venues 1 ──< pitches                 (ON DELETE RESTRICT)
venues 1 ──< venue_amenities         (ON DELETE CASCADE; one row per amenity)
venues 1 ──< media_assets >── 1 pitches   (exactly one owner; RESTRICT)
venues 1 ──< field_verifications >── 1 pitches   (exactly one subject; RESTRICT)
field_sources 1 ──< field_verifications
admin_api_credentials 1 ──< field_revisions, field_publications   (actor; RESTRICT, credentials are revoked, never deleted)
```

`field_revisions` and `field_publications` refer to entities by `(entity_type, entity_id)` without a foreign key, so history survives any later change to the entity.

## Rules enforced by the database

- **Coordinates:** `venues.latitude`/`longitude` are range-checked; `location` is a generated `geography(Point,4326)`. PostGIS silently wraps out-of-range geography input, so the range check must sit on the source columns.
- **Unknown ≠ false:** pitch `surface`, `pitch_format`, `floodlights`, `access` and dimensions, and venue `access`, are nullable. NULL means "not confirmed". Amenities use `tri_state` (`yes`/`no`/`unknown`).
- **Effective pitch access:** `COALESCE(pitch.access, venue.access)` (D11).
- **Publication:** each entity's `status` (`draft | published | archived`) is the single authoritative state; `field_publications` only records transitions.
- **Media publish gate (ADR-0006):** a published `media_assets` row must have a rights basis, an evidence reference, `commercial_use_ok = true`, the attribution fields its basis needs (CC BY / BY-SA: author, source, licence name and URL, attribution text; CC0: source), no NC licence, and a `public_key`. A row that isn't published can't have a `public_key`, so unpublished media never has a public URL.
- **Audit history is append-only:** triggers reject UPDATE, DELETE and TRUNCATE on `field_revisions` and `field_publications`, including for the table owner.
- **Credentials (ADR-0003):** 32-byte hash, unique; 1–20 well-formed scopes; lifetime ≤ 1 year; `token_hash` and `created_at` immutable; revocation can't be undone.

Rules enforced in application code instead: slug immutability after first publish (D18, PR 2.11) and write-time validation via Zod.

## Roles and public access (migration 0003)

| Role                                                        | Can do                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ff_public_reader`                                          | `SELECT` on `public_venues_v`, `public_pitches_v`, `public_media_v`; `EXECUTE` on `search_venues()`. Nothing on any base table.                                                                                                                            |
| `ff_admin_writer`                                           | `SELECT/INSERT/UPDATE` on master content and provenance; `SELECT/INSERT` on the audit tables; `SELECT` and `UPDATE (last_used_at)` on `admin_api_credentials`. No `DELETE` or `TRUNCATE` anywhere. Minting credentials stays with the operator connection. |
| `anon`, `authenticated`, `service_role` (Supabase Data API) | Nothing in `public`, including objects created later (default privileges revoked).                                                                                                                                                                         |

- Both app roles are created `NOLOGIN`. Each environment's operator enables login with a password from that environment's secret store (`alter role ff_public_reader login password '…'`), so no credential lives in a migration.
- The views run with their owner's rights (`security_invoker = false`, `security_barrier = true`), so their `WHERE` clauses are the access control and their column lists are the allowlist. pgTAP `columns_are` tests pin each list.
- **Public visibility:** a venue is public only while it is published **and** has at least one published pitch. A pitch needs itself and its venue published. Media needs to be published and its owner public.
- `public_venues_v.amenities` lists confirmed states only (`{"parking": "yes", "cafe": "no"}`); a missing key means "not confirmed".
- RLS stays enabled (not forced) everywhere. The only policies are `ff_admin_writer_all`, which stop RLS hiding rows from the writer; its grants decide which commands it may run.
- **`search_venues(p_lat, p_lng, p_radius_m, p_surface, p_pitch_format, p_floodlights, p_access, p_amenities, p_after_distance_m, p_after_id, p_limit)`:** one row per venue within 1–50 km, ordered by `(distance_m, venue_id)`. A venue matches only if one published pitch satisfies every pitch filter (effective access `COALESCE(pitch.access, venue.access)`); amenities are venue-level and need `yes`. NULL never matches. The last row's `(distance_m, venue_id)` is the next page's cursor; `total_count` counts every match in the radius. Bad input raises `22023` with the parameter name only. The API (2.7) signs the cursor and validates inputs first.

## Admin rate limits (migration 0005)

- `admin_rate_limits (bucket, window_start, hits, expires_at)`: fixed-window counters for the admin API limiter (ADR-0004). Bucket keys are `<rule>:<sha256 of subject>`, so no raw IP or credential id is stored. Rows expire with their window and are purged by later calls.
- Nobody has privileges on the table. `admin_rate_limit_hit(bucket, window_seconds, limit, cost)` is `SECURITY DEFINER` and executable by `ff_admin_writer` only. Cost 0 checks without counting.

## Planned, not created (spec §4)

These are documented so current choices don't block them. **Do not create them in the MVP.**

- **Organisations** (venue operators): `organisations`, `organisation_members`. Expected link: `venues.organisation_id` (nullable FK), so existing venues stay unowned.
- **Teams:** `teams`, `team_members`, with player accounts behind public authentication (out of scope now).
- **Bookings and availability:** `pitch_slots` (pitch, time range, capacity) and `bookings` (slot, team/user, status). This is what would make the disabled date/time and player filters real. It hangs off `pitches.id`, which is why pitch IDs are stable UUIDs and pitch slugs are only unique per venue.
- **Payments:** handled by a payment provider; only provider references would be stored locally.
- **Slug redirects** (D18 follow-up): `slug_redirects(entity_type, old_slug, entity_id)` if slugs ever need to change after publish.
- **Multi-site** (decisions log, 2026-10-12): other sports would be separate sites with separate databases, so there's no sport or tenant column here.
