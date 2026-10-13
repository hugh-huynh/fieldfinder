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

Rules enforced in application code instead: slug immutability after first publish (D18, PR 2.11), "at least one published pitch" for venue visibility (search function, PR 2.4), and write-time validation via Zod.

## Planned, not created (spec §4)

These are documented so current choices don't block them. **Do not create them in the MVP.**

- **Organisations** (venue operators): `organisations`, `organisation_members`. Expected link: `venues.organisation_id` (nullable FK), so existing venues stay unowned.
- **Teams:** `teams`, `team_members`, with player accounts behind public authentication (out of scope now).
- **Bookings and availability:** `pitch_slots` (pitch, time range, capacity) and `bookings` (slot, team/user, status). This is what would make the disabled date/time and player filters real. It hangs off `pitches.id`, which is why pitch IDs are stable UUIDs and pitch slugs are only unique per venue.
- **Payments:** handled by a payment provider; only provider references would be stored locally.
- **Slug redirects** (D18 follow-up): `slug_redirects(entity_type, old_slug, entity_id)` if slugs ever need to change after publish.
- **Multi-site** (decisions log, 2026-10-12): other sports would be separate sites with separate databases, so there's no sport or tenant column here.
