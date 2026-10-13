-- Roles, published-only views, search_venues() and Data API lockdown (M2 PR 2.4, migration 0003).
-- Synthetic data only (fake names, coordinates near central Melbourne); rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(96);

-- Since PG16 the creating role only gets ADMIN on a new role, not SET, so let the test session
-- switch into the app roles. Rolled back with everything else.
grant ff_public_reader, ff_admin_writer to current_user with inherit false, set true;

-- Runs `q` as role `r` and returns 'ok' or the SQLSTATE `q` raised. The role switch sits outside the
-- handler, so a failed switch aborts the file instead of passing as a fake "permission denied".
-- pgTAP's own bookkeeping stays with the session role.
create function pg_temp.try_as(r text, q text)
returns text
language plpgsql
as $$
begin
  execute format('set local role %I', r);
  begin
    execute q;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

select has_role('ff_public_reader', 'ff_public_reader role exists');
select has_role('ff_admin_writer', 'ff_admin_writer role exists');

select ok(
  (
    select bool_and(not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls
                    and not rolreplication and not rolinherit)
    from pg_roles where rolname in ('ff_public_reader', 'ff_admin_writer')
  ),
  'app roles have no superuser, createdb, createrole, bypassrls, replication or inherit'
);

select ok(
  not exists (
    select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
    where r.rolname in ('ff_public_reader', 'ff_admin_writer')
  ),
  'app roles are not members of any other role'
);

-- ---------------------------------------------------------------------------
-- ff_public_reader: no base tables, ever
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.venues'), '42501', 'reader: SELECT venues is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.pitches'), '42501', 'reader: SELECT pitches is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.venue_amenities'), '42501', 'reader: SELECT venue_amenities is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.media_assets'), '42501', 'reader: SELECT media_assets is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.field_sources'), '42501', 'reader: SELECT field_sources is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.field_verifications'), '42501', 'reader: SELECT field_verifications is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.field_revisions'), '42501', 'reader: SELECT field_revisions is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.field_publications'), '42501', 'reader: SELECT field_publications is denied');
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.admin_api_credentials'), '42501', 'reader: SELECT admin_api_credentials is denied');

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where grantee = 'ff_public_reader' and table_schema = 'public'
      and table_name not in ('public_venues_v', 'public_pitches_v', 'public_media_v')
  ),
  'reader has no privilege on any relation except the three public views'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where grantee = 'ff_public_reader' and table_schema = 'public' and privilege_type <> 'SELECT'
  ),
  'reader has SELECT only on the public views'
);

select is(
  pg_temp.try_as('ff_public_reader', $q$insert into public.public_media_v (id) values (gen_random_uuid())$q$),
  '42501',
  'reader cannot write through the auto-updatable media view'
);

select is(
  pg_temp.try_as('ff_public_reader', $q$select public.admin_scopes_valid(array['venues:write'])$q$),
  '42501',
  'reader cannot execute admin_scopes_valid'
);

-- ---------------------------------------------------------------------------
-- Data API lockdown
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'service_role') and table_schema = 'public'
  ),
  'anon, authenticated and service_role have no privilege on any table or view in public'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
    where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'execute')
  ),
  'no Data API role can execute any function in public'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
    where n.nspname = 'public' and c.relkind = 'S'
      and has_sequence_privilege(r.rolname, c.oid, 'usage,select,update')
  ),
  'no Data API role can use any sequence in public'
);

select is(pg_temp.try_as('anon', 'select 1 from public.venues'), '42501', 'anon: SELECT venues is denied');
select is(pg_temp.try_as('anon', 'select 1 from public.public_venues_v'), '42501', 'anon: SELECT public_venues_v is denied');
select is(pg_temp.try_as('authenticated', 'select 1 from public.public_pitches_v'), '42501', 'authenticated: SELECT public_pitches_v is denied');
select is(pg_temp.try_as('service_role', 'select 1 from public.media_assets'), '42501', 'service_role: SELECT media_assets is denied');
select is(
  pg_temp.try_as('anon', 'select * from public.search_venues(-37.81, 144.96)'),
  '42501',
  'anon cannot execute search_venues'
);

-- Default privileges: a table created later in public is not exposed to the Data API either.
create table public.zz_future_probe (id int);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'zz_future_probe' and grantee in ('anon', 'authenticated', 'service_role')
  ),
  'a newly created table gets no Data API grants by default'
);
drop table public.zz_future_probe;

select ok(
  (
    select bool_and(c.relrowsecurity and not c.relforcerowsecurity)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ),
  'every public table has RLS enabled (not forced, so the views can read as owner)'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and roles && array['public', 'anon', 'authenticated', 'service_role', 'ff_public_reader']::name[]
  ),
  'no RLS policy exists for public, anon, authenticated, service_role or the reader'
);

-- ---------------------------------------------------------------------------
-- View column allowlists (adding a column must be a deliberate test change)
-- ---------------------------------------------------------------------------

select columns_are(
  'public', 'public_venues_v',
  array['id', 'slug', 'name', 'street_address', 'suburb', 'state', 'postcode', 'latitude', 'longitude',
        'description', 'access', 'published_pitch_count', 'amenities', 'updated_at'],
  'public_venues_v exposes only allowlisted columns'
);

select columns_are(
  'public', 'public_pitches_v',
  array['id', 'venue_id', 'venue_slug', 'slug', 'name', 'surface', 'pitch_format', 'length_m', 'width_m',
        'floodlights', 'access', 'effective_access', 'updated_at'],
  'public_pitches_v exposes only allowlisted columns'
);

select columns_are(
  'public', 'public_media_v',
  array['id', 'venue_id', 'pitch_id', 'public_key', 'content_type', 'width_px', 'height_px', 'alt_text',
        'display_order', 'author', 'source_url', 'license_name', 'license_url', 'attribution_text'],
  'public_media_v exposes only allowlisted columns (no storage_key, evidence_ref or rights internals)'
);

-- ---------------------------------------------------------------------------
-- Fixtures
--
-- Origin O = (-37.8100, 144.9600). 0.001 deg of latitude ≈ 111 m.
--   ...0001 same-pitch   published, 1 pitch synthetic+lit (public)             ~111 m
--   ...0002 split        published, pitch A synthetic unlit, B grass lit         ~222 m
--   ...0003 unknowns     published, 1 pitch all-NULL attributes, venue access NULL ~333 m
--   ...0004 inherit      published (booking_required), pitch access NULL; draft pitch synthetic+lit ~444 m
--   ...0005 tie-a        published, same coordinates as tie-b                      ~555 m
--   ...0006 tie-b        published, same coordinates as tie-a                      ~555 m
--   ...0007 draft-venue  draft, published pitch                                    ~111 m
--   ...0008 archived     archived, published pitch                                 ~111 m
--   ...0009 no-pub-pitch published, only draft/archived pitches                    ~111 m
--   ...000a far-away     published, ~22 km away
-- ---------------------------------------------------------------------------

insert into public.venues (id, slug, name, suburb, state, latitude, longitude, access, status) values
  ('00000000-0000-4000-8000-000000000001', 'same-pitch-reserve', 'Same Pitch Reserve', 'Testville', 'VIC', -37.8110, 144.9600, 'public', 'published'),
  ('00000000-0000-4000-8000-000000000002', 'split-reserve', 'Split Reserve', 'Testville', 'VIC', -37.8120, 144.9600, 'public', 'published'),
  ('00000000-0000-4000-8000-000000000003', 'unknown-park', 'Unknown Park', 'Testville', 'VIC', -37.8130, 144.9600, null, 'published'),
  ('00000000-0000-4000-8000-000000000004', 'inherit-oval', 'Inherit Oval', 'Testville', 'VIC', -37.8140, 144.9600, 'booking_required', 'published'),
  ('00000000-0000-4000-8000-000000000005', 'tie-a', 'Tie A', 'Testville', 'VIC', -37.8150, 144.9600, 'public', 'published'),
  ('00000000-0000-4000-8000-000000000006', 'tie-b', 'Tie B', 'Testville', 'VIC', -37.8150, 144.9600, 'public', 'published'),
  ('00000000-0000-4000-8000-000000000007', 'draft-venue', 'Draft Venue', 'Testville', 'VIC', -37.8110, 144.9601, 'public', 'draft'),
  ('00000000-0000-4000-8000-000000000008', 'archived-venue', 'Archived Venue', 'Testville', 'VIC', -37.8110, 144.9602, 'public', 'archived'),
  ('00000000-0000-4000-8000-000000000009', 'no-published-pitch', 'No Published Pitch', 'Testville', 'VIC', -37.8110, 144.9603, 'public', 'published'),
  ('00000000-0000-4000-8000-00000000000a', 'far-away', 'Far Away', 'Farville', 'VIC', -37.6100, 144.9600, 'public', 'published');

insert into public.pitches (id, venue_id, slug, name, surface, pitch_format, floodlights, access, status) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-000000000001', 'main', 'Main', 'synthetic', 'full', true, null, 'published'),
  ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-000000000002', 'pitch-a', 'Pitch A', 'synthetic', 'full', false, null, 'published'),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-000000000002', 'pitch-b', 'Pitch B', 'grass', 'full', true, null, 'published'),
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-000000000003', 'mystery', 'Mystery', null, null, null, null, 'published'),
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-000000000004', 'oval', 'Oval', 'grass', 'full', false, null, 'published'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-000000000004', 'new-turf', 'New Turf', 'synthetic', 'full', true, 'public', 'draft'),
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000005', 'p', 'P', 'grass', 'small_sided', true, 'members_only', 'published'),
  ('00000000-0000-4000-8000-0000000006a1', '00000000-0000-4000-8000-000000000006', 'p', 'P', 'grass', 'small_sided', true, null, 'published'),
  ('00000000-0000-4000-8000-0000000007a1', '00000000-0000-4000-8000-000000000007', 'p', 'P', 'synthetic', 'full', true, null, 'published'),
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-000000000008', 'p', 'P', 'synthetic', 'full', true, null, 'published'),
  ('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000009', 'drafty', 'Drafty', 'synthetic', 'full', true, null, 'draft'),
  ('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-000000000009', 'old', 'Old', 'synthetic', 'full', true, null, 'archived'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'p', 'P', 'synthetic', 'full', true, null, 'published');

insert into public.venue_amenities (venue_id, amenity, state) values
  ('00000000-0000-4000-8000-000000000001', 'parking', 'yes'),
  ('00000000-0000-4000-8000-000000000001', 'toilets', 'yes'),
  ('00000000-0000-4000-8000-000000000001', 'cafe', 'no'),
  ('00000000-0000-4000-8000-000000000001', 'drinking_water', 'unknown'),
  ('00000000-0000-4000-8000-000000000002', 'parking', 'unknown'),
  ('00000000-0000-4000-8000-000000000002', 'toilets', 'yes'),
  ('00000000-0000-4000-8000-000000000003', 'parking', 'no');

-- Media: m1 published on a public venue; m2 draft on a public venue; m3 published on a draft pitch;
-- m4 published on a public pitch; m5 published on a draft venue.
insert into public.media_assets (id, venue_id, pitch_id, storage_key, public_key, content_type, width_px, height_px,
                                 byte_size, alt_text, status, rights_basis, evidence_ref, commercial_use_ok) values
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-000000000001', null, 'private/f001.webp', 'pub/f001.webp',
   'image/webp', 1600, 900, 1000, 'Goal end', 'published', 'owned', 'evidence/f001', true),
  ('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-000000000001', null, 'private/f002.webp', null,
   'image/webp', 1600, 900, 1000, 'Draft shot', 'draft', null, null, null),
  ('00000000-0000-4000-8000-00000000f003', null, '00000000-0000-4000-8000-0000000004b1', 'private/f003.webp', 'pub/f003.webp',
   'image/webp', 1600, 900, 1000, 'New turf', 'published', 'owned', 'evidence/f003', true),
  ('00000000-0000-4000-8000-00000000f004', null, '00000000-0000-4000-8000-0000000001a1', 'private/f004.webp', 'pub/f004.webp',
   'image/webp', 1600, 900, 1000, 'Main pitch', 'published', 'owned', 'evidence/f004', true),
  ('00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-000000000007', null, 'private/f005.webp', 'pub/f005.webp',
   'image/webp', 1600, 900, 1000, 'Draft venue', 'published', 'owned', 'evidence/f005', true);

-- ---------------------------------------------------------------------------
-- Views: published only
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('ff_public_reader', 'select * from public.public_venues_v'), 'ok', 'reader can SELECT public_venues_v');
select is(pg_temp.try_as('ff_public_reader', 'select * from public.public_pitches_v'), 'ok', 'reader can SELECT public_pitches_v');
select is(pg_temp.try_as('ff_public_reader', 'select * from public.public_media_v'), 'ok', 'reader can SELECT public_media_v');

select set_eq(
  $$select slug from public.public_venues_v$$,
  array['same-pitch-reserve', 'split-reserve', 'unknown-park', 'inherit-oval', 'tie-a', 'tie-b', 'far-away'],
  'public_venues_v lists published venues that have a published pitch, and nothing else'
);
select ok(not exists (select 1 from public.public_venues_v where slug = 'draft-venue'), 'draft venue is not in public_venues_v');
select ok(not exists (select 1 from public.public_venues_v where slug = 'archived-venue'), 'archived venue is not in public_venues_v');
select ok(
  not exists (select 1 from public.public_venues_v where slug = 'no-published-pitch'),
  'published venue with only draft/archived pitches is not in public_venues_v'
);

select is(
  (select published_pitch_count from public.public_venues_v where slug = 'inherit-oval'),
  1,
  'published_pitch_count ignores draft pitches'
);
select is(
  (select amenities from public.public_venues_v where slug = 'same-pitch-reserve'),
  '{"cafe": "no", "parking": "yes", "toilets": "yes"}'::jsonb,
  'amenities lists confirmed yes/no states and omits unknown'
);
select is(
  (select amenities from public.public_venues_v where slug = 'tie-a'),
  '{}'::jsonb,
  'a venue with no amenity rows has an empty amenities object'
);

select set_eq(
  $$select id from public.public_pitches_v$$,
  array[
    '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000002b1',
    '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000005a1',
    '00000000-0000-4000-8000-0000000006a1', '00000000-0000-4000-8000-00000000000a'
  ]::uuid[],
  'public_pitches_v lists only published pitches of published venues'
);
select ok(
  not exists (select 1 from public.public_pitches_v where venue_id in (
    '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000008')),
  'published pitches under draft or archived venues are hidden'
);
select is(
  (select effective_access from public.public_pitches_v where id = '00000000-0000-4000-8000-0000000004a1'),
  'booking_required'::public.access_class,
  'effective_access inherits the venue access when the pitch access is NULL'
);
select is(
  (select effective_access from public.public_pitches_v where id = '00000000-0000-4000-8000-0000000005a1'),
  'members_only'::public.access_class,
  'effective_access uses the pitch access when it is set'
);
select ok(
  (select surface is null and pitch_format is null and floodlights is null and access is null and effective_access is null
   from public.public_pitches_v where id = '00000000-0000-4000-8000-0000000003a1'),
  'unknown pitch attributes stay NULL in the view (never guessed)'
);

select set_eq(
  $$select id from public.public_media_v$$,
  array['00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000f004']::uuid[],
  'public_media_v lists only published media whose owner is public'
);
select ok(not exists (select 1 from public.public_media_v where id = '00000000-0000-4000-8000-00000000f002'), 'draft media is hidden');
select ok(not exists (select 1 from public.public_media_v where id = '00000000-0000-4000-8000-00000000f003'), 'published media on a draft pitch is hidden');
select ok(not exists (select 1 from public.public_media_v where id = '00000000-0000-4000-8000-00000000f005'), 'published media on a draft venue is hidden');

-- Unpublishing the only pitch takes the venue, its pitch and its media out of every view.
update public.pitches set status = 'archived' where id = '00000000-0000-4000-8000-0000000001a1';
select ok(
  not exists (select 1 from public.public_venues_v where slug = 'same-pitch-reserve')
  and not exists (select 1 from public.public_media_v where venue_id = '00000000-0000-4000-8000-000000000001'),
  'archiving the only published pitch removes the venue and its media from the views'
);
update public.pitches set status = 'published' where id = '00000000-0000-4000-8000-0000000001a1';

-- ---------------------------------------------------------------------------
-- search_venues(): same-pitch predicate
-- ---------------------------------------------------------------------------

select is(
  pg_temp.try_as('ff_public_reader', 'select * from public.search_venues(-37.81, 144.96)'),
  'ok',
  'reader can execute search_venues'
);

select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96)$$,
  array['same-pitch-reserve', 'split-reserve', 'unknown-park', 'inherit-oval', 'tie-a', 'tie-b'],
  'no filters: every public venue within 10 km, nearest first; draft/archived/no-published-pitch/far venues excluded'
);

select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_surface => 'synthetic', p_floodlights => true)$$,
  array['same-pitch-reserve'],
  'synthetic AND lit: split venue (synthetic pitch unlit, lit pitch grass) is excluded'
);

select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_surface => 'synthetic')$$,
  array['same-pitch-reserve', 'split-reserve'],
  'each half of the split venue still matches on its own'
);

select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_floodlights => false)$$,
  array['split-reserve', 'inherit-oval'],
  'lighting=no needs floodlights = false; NULL (unknown) does not match'
);

select ok(
  not exists (select 1 from public.search_venues(-37.81, 144.96, p_surface => 'grass') where slug = 'unknown-park')
  and not exists (select 1 from public.search_venues(-37.81, 144.96, p_pitch_format => 'full') where slug = 'unknown-park')
  and not exists (select 1 from public.search_venues(-37.81, 144.96, p_floodlights => true) where slug = 'unknown-park')
  and not exists (select 1 from public.search_venues(-37.81, 144.96, p_access => 'public') where slug = 'unknown-park'),
  'a pitch with unknown (NULL) attributes never matches any filter value'
);

select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_access => 'booking_required')$$,
  array['inherit-oval'],
  'access filter uses the venue access when the pitch access is NULL'
);

select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_access => 'members_only')$$,
  array['tie-a'],
  'pitch access overrides venue access'
);

select ok(
  not exists (select 1 from public.search_venues(-37.81, 144.96, p_surface => 'synthetic', p_floodlights => true)
              where slug = 'inherit-oval'),
  'a draft pitch never satisfies a filter'
);

select results_eq(
  $$select published_pitch_count, matching_pitch_count from public.search_venues(-37.81, 144.96, p_surface => 'synthetic')
    where slug = 'split-reserve'$$,
  $$values (2, 1)$$,
  'counts: published_pitch_count and matching_pitch_count for a filtered venue'
);

select results_eq(
  $$select published_pitch_count, matching_pitch_count from public.search_venues(-37.81, 144.96) where slug = 'inherit-oval'$$,
  $$values (1, 1)$$,
  'counts ignore draft pitches'
);

-- Amenities: venue-level, state = 'yes' only, all requested must match.
select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_amenities => array['toilets']::public.amenity_key[])$$,
  array['same-pitch-reserve', 'split-reserve'],
  'amenity filter matches state = yes'
);
select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_amenities => array['toilets', 'parking']::public.amenity_key[])$$,
  array['same-pitch-reserve'],
  'every requested amenity must be yes (unknown parking does not match)'
);
select is_empty(
  $$select 1 from public.search_venues(-37.81, 144.96, p_amenities => array['cafe']::public.amenity_key[])$$,
  'amenity state no does not match'
);
select results_eq(
  $$select count(*)::int from public.search_venues(-37.81, 144.96, p_amenities => array[]::public.amenity_key[])$$,
  $$values (6)$$,
  'an empty amenity list applies no amenity filter'
);

-- Radius
select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96, p_radius_m => 1000)$$,
  array['same-pitch-reserve', 'split-reserve', 'unknown-park', 'inherit-oval', 'tie-a', 'tie-b'],
  '1 km radius'
);
select ok(
  exists (select 1 from public.search_venues(-37.81, 144.96, p_radius_m => 25000) where slug = 'far-away')
  and not exists (select 1 from public.search_venues(-37.81, 144.96, p_radius_m => 20000) where slug = 'far-away'),
  'radius bounds are applied in metres (~22 km venue in at 25 km, out at 20 km)'
);
select ok(
  (select bool_and(distance_m between 100 and 120) from public.search_venues(-37.81, 144.96) where slug = 'same-pitch-reserve'),
  'distance_m is in metres'
);

-- ---------------------------------------------------------------------------
-- search_venues(): keyset pagination and total_count
-- ---------------------------------------------------------------------------

select results_eq(
  $$select slug from public.search_venues(-37.81, 144.96) where slug like 'tie-%'$$,
  $$select slug from public.venues where slug like 'tie-%' order by id$$,
  'equal distances are ordered by venue id'
);

select is(
  (select array_agg(distinct total_count) from public.search_venues(-37.81, 144.96, p_limit => 2)),
  array[6::bigint],
  'total_count is the full match count, not the page size'
);

-- Walk pages of 2 using the last row of each page as the cursor; the result must equal the unpaged list.
create temp table walked (n int generated always as identity, venue_id uuid, distance_m double precision);
do $$
declare
  last_d double precision;
  last_id uuid;
  got int;
begin
  loop
    insert into walked (venue_id, distance_m)
    select s.venue_id, s.distance_m
    from public.search_venues(-37.81, 144.96, p_limit => 2, p_after_distance_m => last_d, p_after_id => last_id) s;
    get diagnostics got = row_count;
    exit when got = 0;
    select w.distance_m, w.venue_id into last_d, last_id from walked w order by w.n desc limit 1;
  end loop;
end;
$$;

select results_eq(
  $$select venue_id from walked order by n$$,
  $$select venue_id from public.search_venues(-37.81, 144.96, p_limit => 30)$$,
  'paging by (distance_m, venue_id) yields every match once, in order, with no gaps'
);
select is((select count(*) - count(distinct venue_id) from walked), 0::bigint, 'paging yields no duplicates');

select results_eq(
  $$select s.slug from public.search_venues(
      -37.81, 144.96,
      p_after_distance_m => (select distance_m from public.search_venues(-37.81, 144.96) where slug = 'tie-a'),
      p_after_id => '00000000-0000-4000-8000-000000000005') s$$,
  array['tie-b'],
  'a cursor inside a distance tie continues with the next id at that distance'
);

-- ---------------------------------------------------------------------------
-- search_venues(): input validation (22023, no row data in the message)
-- ---------------------------------------------------------------------------

select throws_ok($$select * from public.search_venues(91, 144.96)$$, '22023', 'invalid p_lat', 'latitude 91 is rejected');
select throws_ok($$select * from public.search_venues(null, 144.96)$$, '22023', 'invalid p_lat', 'NULL latitude is rejected');
select throws_ok($$select * from public.search_venues('NaN', 144.96)$$, '22023', 'invalid p_lat', 'NaN latitude is rejected');
select throws_ok($$select * from public.search_venues(-37.81, 180.5)$$, '22023', 'invalid p_lng', 'longitude 180.5 is rejected');
select throws_ok($$select * from public.search_venues(-37.81, 144.96, p_radius_m => 999)$$, '22023', 'invalid p_radius_m', 'radius below 1 km is rejected');
select throws_ok($$select * from public.search_venues(-37.81, 144.96, p_radius_m => 50001)$$, '22023', 'invalid p_radius_m', 'radius above 50 km is rejected');
select throws_ok($$select * from public.search_venues(-37.81, 144.96, p_limit => 0)$$, '22023', 'invalid p_limit', 'limit 0 is rejected');
select throws_ok($$select * from public.search_venues(-37.81, 144.96, p_limit => 31)$$, '22023', 'invalid p_limit', 'limit 31 is rejected');
select throws_ok(
  $$select * from public.search_venues(-37.81, 144.96, p_after_distance_m => 10)$$,
  '22023', 'cursor needs both p_after_distance_m and p_after_id', 'a half cursor is rejected'
);
select throws_ok(
  $$select * from public.search_venues(-37.81, 144.96, p_after_distance_m => 'NaN', p_after_id => gen_random_uuid())$$,
  '22023', 'invalid p_after_distance_m', 'a NaN cursor distance is rejected'
);
select throws_ok(
  $$select * from public.search_venues(-37.81, 144.96, p_amenities => array['parking', null]::public.amenity_key[])$$,
  '22023', 'invalid p_amenities', 'a NULL amenity is rejected'
);

-- ---------------------------------------------------------------------------
-- ff_admin_writer: least privilege
-- ---------------------------------------------------------------------------

select is(
  pg_temp.try_as('ff_admin_writer', $q$insert into public.venues (slug, name, suburb, state, latitude, longitude)
                                      values ('writer-made', 'Writer Made', 'Testville', 'VIC', -37.8, 144.9)$q$),
  'ok',
  'writer can insert a venue (RLS policy lets it through)'
);
select is(
  pg_temp.try_as('ff_admin_writer', $q$update public.pitches set name = 'Main Pitch' where id = '00000000-0000-4000-8000-0000000001a1'$q$),
  'ok',
  'writer can update a pitch'
);
select is((select name from public.pitches where id = '00000000-0000-4000-8000-0000000001a1'), 'Main Pitch', 'the writer''s update was applied (RLS did not hide the row)');
select is(
  pg_temp.try_as('ff_admin_writer', $q$delete from public.venue_amenities where venue_id = '00000000-0000-4000-8000-000000000003'$q$),
  '42501',
  'writer cannot delete'
);
select is(
  pg_temp.try_as('ff_admin_writer', $q$insert into public.field_revisions (entity_type, entity_id, action, actor_label)
                                      values ('venue', '00000000-0000-4000-8000-000000000001', 'update', 'test-writer')$q$),
  'ok',
  'writer can append a revision'
);
select is(
  pg_temp.try_as('ff_admin_writer', $q$update public.field_revisions set actor_label = 'x'$q$),
  '42501',
  'writer cannot update revisions'
);

insert into public.admin_api_credentials (id, label, token_hash, scopes, expires_at)
values ('00000000-0000-4000-8000-00000000c001', 'test-credential', sha256('synthetic-token'::bytea), array['venues:write'],
        now() + interval '30 days');

select is(
  pg_temp.try_as('ff_admin_writer', $q$select id from public.admin_api_credentials where token_hash = sha256('synthetic-token'::bytea)$q$),
  'ok',
  'writer can look up a credential by hash'
);
select is(
  pg_temp.try_as('ff_admin_writer', $q$update public.admin_api_credentials set last_used_at = now()
                                      where id = '00000000-0000-4000-8000-00000000c001'$q$),
  'ok',
  'writer can record last use (the scopes CHECK still runs for it)'
);
select is(
  pg_temp.try_as('ff_admin_writer', $q$update public.admin_api_credentials set expires_at = now() + interval '300 days'$q$),
  '42501',
  'writer cannot extend a credential'
);
select is(
  pg_temp.try_as('ff_admin_writer', $q$insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
                                      values ('minted', sha256('x'::bytea), array['venues:write'], now() + interval '1 day')$q$),
  '42501',
  'writer cannot mint credentials'
);
select is(pg_temp.try_as('ff_admin_writer', 'truncate public.venue_amenities'), '42501', 'writer cannot truncate');

select * from finish();

rollback;
