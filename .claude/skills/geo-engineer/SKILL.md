---
name: geo-engineer
description: Design or change geospatial data and queries — PostGIS schema, WGS84 coordinates, meter distances, radius/viewport bounding, keyset cursor pagination, the same-pitch filter predicate, coordinate rounding for privacy, and geo fixtures. Use for supabase/migrations touching location, search_venues(), /api/venues and search-this-area logic.
---

## Inputs

Spec §1 acceptance principles, §4, §5 public search; ADR-0002 and ADR-0005; fixtures.

## Constraints

- `geography(Point,4326)`; lng/lat order in `ST_MakePoint`; `ST_DWithin` for radius (meters), `ST_Distance` for ordering.
- Radius 1–50 km (default 10 km); limit ≤ 30; keyset on `(distance_m, venue_id)`; cursor HMAC-signed and bound to the normalized query.
- Same-pitch rule: a venue matches only if EXISTS one published pitch satisfying ALL active pitch filters (surface, format, lighting, effective access = `COALESCE(pitch.access, venue.access)`); amenities are venue-level, `state = 'yes'`. NULL never matches yes or no.
- Only published venues/pitches/media; a venue without published pitches is excluded.
- Device-derived coordinates rounded to 2 dp before leaving the client (ADR-0005).
- Migrations forward-only; ask before any schema change not in the approved ticket.

## Steps

1. Write the predicate/test matrix first (fixtures for split-attribute venues).
2. Implement SQL + `EXPLAIN ANALYZE` on fixture scale.
3. Integration tests via local Supabase.

## Outputs

Migration/SQL function, typed repository function, integration tests, EXPLAIN notes in PR.

## Completion checklist

- [ ] Split-attribute venue excluded; same-pitch venue included
- [ ] Pagination: no dupes/gaps across pages; tampered cursor → 400
- [ ] Coordinate range and radius bounds rejected server-side
- [ ] Index used (EXPLAIN shown)
