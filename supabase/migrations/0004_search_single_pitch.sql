-- 0004_search_single_pitch: search_venues() also returns the slug of a venue's only published pitch
-- (M2 PR 2.8). Spec §2: a single-published-pitch venue links straight to its pitch page from a search
-- card or marker preview, so search results need that slug. Forward-only: never edit after merge.
--
-- The return type changes, which CREATE OR REPLACE can't do, so the function is dropped and
-- recreated with the same arguments, behaviour and grants as in 0003. The only change is the new
-- single_pitch_slug column.

drop function public.search_venues(
  double precision, double precision, integer, public.surface, public.pitch_format, boolean,
  public.access_class, public.amenity_key[], double precision, uuid, integer
);

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
  -- Slug of the venue's only published pitch; NULL when it has several (0 never reaches results).
  single_pitch_slug text,
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
      counts.matching_pitch_count,
      counts.single_pitch_slug
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
        ))::integer as matching_pitch_count,
        -- Counts every published pitch, not only matching ones: routing ignores the filters (spec §2).
        case when count(*) = 1 then min(p.slug) end as single_pitch_slug
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
    m.single_pitch_slug,
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

