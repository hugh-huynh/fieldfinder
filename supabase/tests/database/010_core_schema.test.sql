-- Core schema constraints (M2 PR 2.2, migration 0001_core). Synthetic data only; rolled back.
begin;

create extension if not exists pgtap with schema extensions;

-- Start from an empty content set so results never depend on supabase/seed.sql (rolled back).
delete from public.field_verifications;
delete from public.field_sources;
delete from public.media_assets;
delete from public.venue_amenities;
delete from public.pitches;
delete from public.venues;

select plan(36);

-- ---------------------------------------------------------------------------
-- Structure and lockdown
-- ---------------------------------------------------------------------------

select has_table('public', 'venues', 'venues table exists');
select has_table('public', 'pitches', 'pitches table exists');
select has_table('public', 'venue_amenities', 'venue_amenities table exists');
select has_index('public', 'venues', 'venues_location_published_gix', 'published venues have a GiST location index');
select has_index('public', 'pitches', 'pitches_published_venue_idx', 'published pitches are indexed by venue');

select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.venues'::regclass, 'public.pitches'::regclass, 'public.venue_amenities'::regclass)),
  'row level security is enabled on every master table'
);

select table_privs_are('public', 'venues', 'anon', array[]::text[], 'anon has no privileges on venues');
select table_privs_are('public', 'pitches', 'anon', array[]::text[], 'anon has no privileges on pitches');
select table_privs_are('public', 'venue_amenities', 'anon', array[]::text[], 'anon has no privileges on venue_amenities');
select table_privs_are('public', 'venues', 'authenticated', array[]::text[], 'authenticated has no privileges on venues');
select table_privs_are('public', 'pitches', 'authenticated', array[]::text[], 'authenticated has no privileges on pitches');
select table_privs_are('public', 'venue_amenities', 'authenticated', array[]::text[], 'authenticated has no privileges on venue_amenities');

-- ---------------------------------------------------------------------------
-- Venues: coordinates
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.venues (id, slug, name, suburb, state, postcode, latitude, longitude)
    values ('00000000-0000-4000-8000-000000000001', 'test-reserve', 'Test Reserve', 'Testville', 'VIC', '3000', -37.8136, 144.9631)$$,
  'a valid venue can be inserted'
);

select is(
  (select extensions.st_astext(location) from public.venues where slug = 'test-reserve'),
  'POINT(144.9631 -37.8136)',
  'location is derived from longitude/latitude in WGS84 order'
);

select is(
  (select status from public.venues where slug = 'test-reserve'),
  'draft'::public.publication_status,
  'new venues default to draft'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('lat-high', 'X', 'X', 'VIC', 91, 0)$$,
  '23514', null, 'latitude above 90 is rejected (not wrapped by PostGIS)'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('lat-low', 'X', 'X', 'VIC', -90.5, 0)$$,
  '23514', null, 'latitude below -90 is rejected'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('lng-high', 'X', 'X', 'VIC', 0, 181)$$,
  '23514', null, 'longitude above 180 is rejected (not wrapped by PostGIS)'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('lng-nan', 'X', 'X', 'VIC', 0, 'NaN')$$,
  '23514', null, 'NaN coordinates are rejected'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude, location)
    values ('direct-loc', 'X', 'X', 'VIC', 0, 0, 'SRID=4326;POINT(1 1)')$$,
  '428C9', null, 'location cannot be written directly'
);

-- ---------------------------------------------------------------------------
-- Venues: identity and text fields
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('test-reserve', 'Dup', 'X', 'VIC', 0, 0)$$,
  '23505', null, 'duplicate venue slug is rejected'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('Bad Slug', 'X', 'X', 'VIC', 0, 0)$$,
  '23514', null, 'slug with uppercase/space is rejected'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('-leading', 'X', 'X', 'VIC', 0, 0)$$,
  '23514', null, 'slug with leading hyphen is rejected'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('blank-name', '   ', 'X', 'VIC', 0, 0)$$,
  '23514', null, 'blank venue name is rejected'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, latitude, longitude) values ('bad-state', 'X', 'X', 'Victoria', 0, 0)$$,
  '23514', null, 'state must be an Australian state/territory code'
);

select throws_ok(
  $$insert into public.venues (slug, name, suburb, state, postcode, latitude, longitude) values ('bad-pc', 'X', 'X', 'VIC', '300', 0, 0)$$,
  '23514', null, 'postcode must be four digits'
);

-- ---------------------------------------------------------------------------
-- Pitches
-- ---------------------------------------------------------------------------

insert into public.venues (id, slug, name, suburb, state, latitude, longitude)
values ('00000000-0000-4000-8000-000000000002', 'other-park', 'Other Park', 'Testville', 'VIC', -37.80, 144.95);

select lives_ok(
  $$insert into public.pitches (venue_id, slug, name) values ('00000000-0000-4000-8000-000000000001', 'pitch-1', 'Pitch 1')$$,
  'a pitch with every attribute unknown (NULL) can be inserted'
);

select lives_ok(
  $$insert into public.pitches (venue_id, slug, name, surface, pitch_format, floodlights, access, length_m, width_m)
    values ('00000000-0000-4000-8000-000000000002', 'pitch-1', 'Pitch 1', 'synthetic', 'full', true, 'public', 105, 68)$$,
  'the same pitch slug is allowed at a different venue'
);

select throws_ok(
  $$insert into public.pitches (venue_id, slug, name) values ('00000000-0000-4000-8000-000000000001', 'pitch-1', 'Again')$$,
  '23505', null, 'duplicate pitch slug within one venue is rejected'
);

select throws_ok(
  $$insert into public.pitches (venue_id, slug, name) values ('00000000-0000-4000-8000-0000000000ff', 'orphan', 'Orphan')$$,
  '23503', null, 'pitch must belong to an existing venue'
);

select throws_ok(
  $$insert into public.pitches (venue_id, slug, name, length_m) values ('00000000-0000-4000-8000-000000000001', 'zero-len', 'X', 0)$$,
  '23514', null, 'pitch dimensions must be positive'
);

select throws_ok(
  $$delete from public.venues where id = '00000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'deleting a venue that has pitches is blocked'
);

-- ---------------------------------------------------------------------------
-- Venue amenities
-- ---------------------------------------------------------------------------

insert into public.venues (id, slug, name, suburb, state, latitude, longitude)
values ('00000000-0000-4000-8000-000000000003', 'no-pitch-oval', 'No Pitch Oval', 'Testville', 'VIC', -37.79, 144.94);

insert into public.venue_amenities (venue_id, amenity, state)
values ('00000000-0000-4000-8000-000000000003', 'toilets', 'yes');

select throws_ok(
  $$insert into public.venue_amenities (venue_id, amenity, state) values ('00000000-0000-4000-8000-000000000003', 'toilets', 'no')$$,
  '23505', null, 'an amenity can be recorded once per venue'
);

select lives_ok(
  $$delete from public.venues where id = '00000000-0000-4000-8000-000000000003'$$,
  'a venue without pitches can be deleted'
);

select is(
  (select count(*)::int from public.venue_amenities where venue_id = '00000000-0000-4000-8000-000000000003'),
  0,
  'deleting a venue removes its amenity rows'
);

-- ---------------------------------------------------------------------------
-- updated_at trigger (now() is fixed within a transaction, so backdate first)
-- ---------------------------------------------------------------------------

alter table public.venues disable trigger venues_set_updated_at;
update public.venues set updated_at = '2000-01-01' where slug = 'other-park';
alter table public.venues enable trigger venues_set_updated_at;
update public.venues set name = 'Other Park Renamed' where slug = 'other-park';

select is(
  (select updated_at from public.venues where slug = 'other-park'),
  now(),
  'updating a venue refreshes updated_at'
);

select * from finish();

rollback;
