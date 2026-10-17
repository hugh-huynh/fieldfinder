-- Seeded fixture state (M2 PR 2.5). Unlike the other files this one relies on supabase/seed.sql,
-- which `supabase db reset` loads. Origin: Melbourne CBD (-37.8136, 144.9631). Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- Counts: every fixture loaded, and only the public ones are visible
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.venues), 14, 'all 14 fixture venues are seeded');
select is((select count(*)::int from public.pitches), 20, 'all 20 fixture pitches are seeded');
select is((select count(*)::int from public.media_assets), 7, 'all 7 fixture images are seeded');

select ok(
  (select bool_and(id::text like '5eed0000-%') from public.venues),
  'seeded rows use the fixture UUID namespace'
);

select is(
  (select count(*)::int from public.public_venues_v),
  11,
  'draft, archived and all-draft-pitch venues are hidden (11 of 14 public)'
);

select is((select count(*)::int from public.public_pitches_v), 15, 'only published pitches of published venues are public');
select is((select count(*)::int from public.public_media_v), 5, 'draft images are hidden (5 of 7 public)');

-- ---------------------------------------------------------------------------
-- Private markers never reach the public views
-- ---------------------------------------------------------------------------

select ok(
  not exists (select 1 from public.public_venues_v v where v::text like '%ff-private-sentinel%')
  and not exists (select 1 from public.public_pitches_v p where p::text like '%ff-private-sentinel%')
  and not exists (select 1 from public.public_media_v m where m::text like '%ff-private-sentinel%'),
  'no public view row contains the private sentinel'
);

-- ---------------------------------------------------------------------------
-- Search behaviour the UI and API tests rely on
-- ---------------------------------------------------------------------------

select set_eq(
  $$select slug from public.search_venues(-37.8136, 144.9631)$$,
  array['wattlebird-reserve', 'ironbark-park', 'banksias-corner-reserve', 'paperbark-common',
        'kurrajong-recreation-ground', 'saltbush-sports-park', 'coastal-heath-reserve'],
  'default 10 km search from the CBD returns the 7 nearby public venues'
);

select is(
  (select count(*)::int from public.search_venues(-37.8136, 144.9631, p_radius_m => 50000)),
  10,
  'a 50 km search adds the three outer venues but not the one beyond 50 km'
);

select set_eq(
  $$select slug from public.search_venues(-37.8136, 144.9631, p_surface => 'synthetic', p_floodlights => true)$$,
  array['wattlebird-reserve', 'saltbush-sports-park'],
  'synthetic + lit excludes the split-attribute venue (ironbark-park)'
);

select ok(
  not exists (select 1 from public.search_venues(-37.8136, 144.9631, p_floodlights => false) where slug = 'paperbark-common')
  and not exists (select 1 from public.search_venues(-37.8136, 144.9631, p_floodlights => true) where slug = 'paperbark-common'),
  'unknown floodlights match neither yes nor no'
);

select is(
  (select published_pitch_count from public.search_venues(-37.8136, 144.9631) where slug = 'banksias-corner-reserve'),
  1,
  'a draft pitch does not count towards published_pitch_count'
);

-- single_pitch_slug (migration 0004): the only published pitch, ignoring drafts, archived pitches
-- and the active filters, so search can link straight to the pitch page.
select results_eq(
  $$select slug, single_pitch_slug from public.search_venues(-37.8136, 144.9631)
    where slug in ('wattlebird-reserve', 'banksias-corner-reserve') order by slug$$,
  $$values ('banksias-corner-reserve', 'north-pitch'), ('wattlebird-reserve', 'main-pitch')$$,
  'single_pitch_slug names the only published pitch, ignoring a draft one'
);

select is(
  (select count(*)::int from public.search_venues(-37.8136, 144.9631, p_radius_m => 50000)
    where published_pitch_count > 1 and single_pitch_slug is not null),
  0,
  'single_pitch_slug is NULL for every venue with several published pitches (archived ones ignored)'
);

select is(
  (select single_pitch_slug from public.search_venues(-37.8136, 144.9631, p_surface => 'hybrid')
    where slug = 'ironbark-park'),
  null,
  'one matching pitch out of three published still leaves single_pitch_slug NULL'
);

select set_eq(
  $$select slug from public.search_venues(-37.8136, 144.9631, p_access => 'booking_required')$$,
  array['kurrajong-recreation-ground'],
  'a pitch with NULL access inherits booking_required from its venue'
);

select * from finish();

rollback;
