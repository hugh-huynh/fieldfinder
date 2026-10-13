-- 0003_roles_views: application roles, published-only views, search_venues() and Data API lockdown (M2 PR 2.4).
-- Spec §1, §4, §5; ADR-0002 (D2, D11). Forward-only: never edit this file after merge.
--
-- Model:
--   * ff_public_reader reads published data only, through the public_*_v views and search_venues().
--     It has no privilege on any base table, so a missing grant fails closed.
--   * ff_admin_writer is used only by authenticated admin routes. It reads and writes master
--     content, appends to the audit tables, and never deletes.
--   * anon, authenticated and service_role (the Supabase Data API roles) have no access to anything here.
--
-- Both roles are created NOLOGIN. Each environment's operator enables login with a password kept in
-- that environment's secret store, so no credential ever lives in a migration.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- Roles are cluster-wide and can outlive `supabase db reset`, so create them only when missing.
-- Supabase's `postgres` isn't a superuser and can't ALTER superuser-level attributes, so a role that
-- already exists with dangerous attributes stops the migration instead of being silently reused.
do $$
declare
  r text;
begin
  foreach r in array array['ff_public_reader', 'ff_admin_writer'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      -- Every other attribute defaults to NO (superuser, createdb, createrole, replication, bypassrls).
      execute format('create role %I nologin noinherit', r);
    elsif exists (
      select 1 from pg_roles
      where rolname = r
        and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit)
    ) then
      raise exception 'role % already exists with unsafe attributes', r using errcode = '42501';
    end if;
  end loop;
end;
$$;

grant usage on schema public to ff_public_reader, ff_admin_writer;

-- ---------------------------------------------------------------------------
-- Data API lockdown (ADR-0002): the app never uses PostgREST/GraphQL, so the Data API roles get
-- nothing in `public`, now or later. Hosted projects grant these by default.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke execute on all functions in schema public from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
-- Future functions are not executable by anyone but their owner until explicitly granted.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- RLS stays enabled on every table, with no policies for anon/authenticated (0001/0002). It is not
-- FORCEd: the views below rely on their owner (the table owner) reading the base tables.

-- ---------------------------------------------------------------------------
-- Published-only views (allowlisted columns)
--
-- These run with the view owner's rights (security_invoker = false), so ff_public_reader needs no
-- base-table privilege; the WHERE clauses are the access control. security_barrier stops a caller's
-- functions being pushed below those filters. Never expose a column here unless it is meant to be public.
-- ---------------------------------------------------------------------------

-- A venue is public only while it is published AND has at least one published pitch (spec §4).
create view public.public_venues_v
with (security_invoker = false, security_barrier = true)
as
select
  v.id,
  v.slug,
  v.name,
  v.street_address,
  v.suburb,
  v.state,
  v.postcode,
  v.latitude,
  v.longitude,
  v.description,
  v.access,
  pc.published_pitch_count,
  -- Confirmed amenities only: {"parking": "yes", "cafe": "no"}. A missing key means "not confirmed".
  coalesce(
    (
      select jsonb_object_agg(va.amenity, va.state order by va.amenity)
      from public.venue_amenities va
      where va.venue_id = v.id and va.state <> 'unknown'
    ),
    '{}'::jsonb
  ) as amenities,
  v.updated_at
from public.venues v
cross join lateral (
  select count(*)::integer as published_pitch_count
  from public.pitches p
  where p.venue_id = v.id and p.status = 'published'
) pc
where v.status = 'published'
  and pc.published_pitch_count > 0;

-- A pitch is public only while it and its venue are published.
create view public.public_pitches_v
with (security_invoker = false, security_barrier = true)
as
select
  p.id,
  p.venue_id,
  v.slug as venue_slug,
  p.slug,
  p.name,
  p.surface,
  p.pitch_format,
  p.length_m,
  p.width_m,
  p.floodlights,
  -- The pitch's own access (NULL = inherits) and the effective value used by filters (D11).
  p.access,
  coalesce(p.access, v.access) as effective_access,
  p.updated_at
from public.pitches p
join public.venues v on v.id = p.venue_id
where p.status = 'published'
  and v.status = 'published';

-- Media is public only while it is published (the 0002 publish gate guarantees rights and a public_key)
-- and its owner is public. Private storage keys, evidence and rights internals are never exposed;
-- attribution fields are, because licences require them to be shown.
create view public.public_media_v
with (security_invoker = false, security_barrier = true)
as
select
  m.id,
  m.venue_id,
  m.pitch_id,
  m.public_key,
  m.content_type,
  m.width_px,
  m.height_px,
  m.alt_text,
  m.display_order,
  m.author,
  m.source_url,
  m.license_name,
  m.license_url,
  m.attribution_text
from public.media_assets m
where m.status = 'published'
  and m.public_key is not null
  and (
    exists (select 1 from public.public_venues_v pv where pv.id = m.venue_id)
    or exists (select 1 from public.public_pitches_v pp where pp.id = m.pitch_id)
  );

revoke all on public.public_venues_v, public.public_pitches_v, public.public_media_v
  from public, anon, authenticated, service_role;
grant select on public.public_venues_v, public.public_pitches_v, public.public_media_v to ff_public_reader;

-- ---------------------------------------------------------------------------
-- search_venues(): bounded radius search with the same-pitch predicate and keyset paging
--
-- One row per venue. A venue matches only if ONE published pitch satisfies EVERY active pitch filter
-- (surface, pitch_format, floodlights, effective access = COALESCE(pitch.access, venue.access)).
-- Amenities are venue-level and need state = 'yes'. A NULL attribute never matches any filter value.
-- Ordered by (distance_m, venue_id); pass the last row's pair as the cursor to get the next page.
-- Inputs are validated here as well as in the API (2.7), and errors never echo row data.
-- ---------------------------------------------------------------------------

create function public.search_venues(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 10000,
  p_surface public.surface default null,
  p_pitch_format public.pitch_format default null,
  p_floodlights boolean default null,
  p_access public.access_class default null,
  p_amenities public.amenity_key[] default null,
  p_after_distance_m double precision default null,
  p_after_id uuid default null,
  p_limit integer default 20
)
returns table (
  venue_id uuid,
  slug text,
  name text,
  suburb text,
  state text,
  latitude double precision,
  longitude double precision,
  access public.access_class,
  distance_m double precision,
  published_pitch_count integer,
  matching_pitch_count integer,
  -- Matches in the whole radius, ignoring the cursor and limit (D8).
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_origin extensions.geography;
begin
  -- BETWEEN is false for NULL and NaN (NaN sorts above every number), so both are rejected.
  if not coalesce(p_lat between -90 and 90, false) then
    raise exception 'invalid p_lat' using errcode = '22023';
  end if;
  if not coalesce(p_lng between -180 and 180, false) then
    raise exception 'invalid p_lng' using errcode = '22023';
  end if;
  if not coalesce(p_radius_m between 1000 and 50000, false) then
    raise exception 'invalid p_radius_m' using errcode = '22023';
  end if;
  if not coalesce(p_limit between 1 and 30, false) then
    raise exception 'invalid p_limit' using errcode = '22023';
  end if;
  if (p_after_distance_m is null) <> (p_after_id is null) then
    raise exception 'cursor needs both p_after_distance_m and p_after_id' using errcode = '22023';
  end if;
  if p_after_distance_m is not null and not (p_after_distance_m between 0 and 100000) then
    raise exception 'invalid p_after_distance_m' using errcode = '22023';
  end if;
  if p_amenities is not null and (array_position(p_amenities, null) is not null or cardinality(p_amenities) > 20) then
    raise exception 'invalid p_amenities' using errcode = '22023';
  end if;

  v_origin := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;

  return query
  with candidates as (
    select
      v.id,
      v.slug,
      v.name,
      v.suburb,
      v.state,
      v.latitude,
      v.longitude,
      v.access,
      extensions.st_distance(v.location, v_origin) as distance_m,
      counts.published_pitch_count,
      counts.matching_pitch_count
    from public.venues v
    cross join lateral (
      select
        count(*)::integer as published_pitch_count,
        -- The same-pitch predicate: every condition is evaluated against one pitch row.
        (count(*) filter (
          where (p_surface is null or p.surface = p_surface)
            and (p_pitch_format is null or p.pitch_format = p_pitch_format)
            and (p_floodlights is null or p.floodlights = p_floodlights)
            and (p_access is null or coalesce(p.access, v.access) = p_access)
        ))::integer as matching_pitch_count
      from public.pitches p
      where p.venue_id = v.id and p.status = 'published'
    ) counts
    -- `status = 'published'` matches the partial GiST index venues_location_published_gix.
    where v.status = 'published'
      and extensions.st_dwithin(v.location, v_origin, p_radius_m)
      and (
        p_amenities is null
        or not exists (
          select 1
          from unnest(p_amenities) as req(amenity)
          where not exists (
            select 1
            from public.venue_amenities va
            where va.venue_id = v.id and va.amenity = req.amenity and va.state = 'yes'
          )
        )
      )
  ),
  matches as (
    select * from candidates c where c.matching_pitch_count > 0
  )
  select
    m.id,
    m.slug,
    m.name,
    m.suburb,
    m.state,
    m.latitude,
    m.longitude,
    m.access,
    m.distance_m,
    m.published_pitch_count,
    m.matching_pitch_count,
    (select count(*) from matches)::bigint
  from matches m
  where p_after_id is null
     or (m.distance_m, m.id) > (p_after_distance_m, p_after_id)
  order by m.distance_m, m.id
  limit p_limit;
end;
$$;

revoke execute on function public.search_venues(
  double precision, double precision, integer, public.surface, public.pitch_format, boolean,
  public.access_class, public.amenity_key[], double precision, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.search_venues(
  double precision, double precision, integer, public.surface, public.pitch_format, boolean,
  public.access_class, public.amenity_key[], double precision, uuid, integer
) to ff_public_reader;

-- ---------------------------------------------------------------------------
-- ff_admin_writer: least privilege for the admin API (2.9–2.12)
--
-- No DELETE anywhere (soft unpublish/archive, spec §5) and no TRUNCATE. Minting and revoking
-- credentials stays with the operator connection (PR 2.9 script); the API only looks credentials
-- up and records last use.
-- ---------------------------------------------------------------------------

grant select, insert, update on
  public.venues,
  public.pitches,
  public.venue_amenities,
  public.media_assets,
  public.field_sources,
  public.field_verifications
to ff_admin_writer;

-- Audit history: append and read only (the 0002 triggers also block UPDATE/DELETE/TRUNCATE).
grant select, insert on public.field_revisions, public.field_publications to ff_admin_writer;

grant select on public.admin_api_credentials to ff_admin_writer;
grant update (last_used_at) on public.admin_api_credentials to ff_admin_writer;

-- CHECK constraints run their functions with the writing role's privileges, and the credentials
-- CHECK uses this one, so the writer must keep EXECUTE after the blanket revoke above.
grant execute on function public.admin_scopes_valid(text[]) to ff_admin_writer;

-- RLS is enabled on every table, so the writer needs explicit policies. Grants above decide which
-- commands it may run; these policies only stop RLS hiding rows from it. No policy exists for
-- anon, authenticated or ff_public_reader.
create policy ff_admin_writer_all on public.venues for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.pitches for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.venue_amenities for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.media_assets for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.field_sources for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.field_verifications for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.field_revisions for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.field_publications for all to ff_admin_writer using (true) with check (true);
create policy ff_admin_writer_all on public.admin_api_credentials for all to ff_admin_writer using (true) with check (true);
