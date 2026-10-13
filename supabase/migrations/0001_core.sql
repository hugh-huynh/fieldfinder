-- 0001_core: venues, pitches and venue amenities (M2 PR 2.2).
-- Spec §4 "Tables (initial)"; ADR-0002. Forward-only: never edit this file after merge.
--
-- Unknown is never stored as a guess: nullable attribute columns mean "not confirmed".

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Single authoritative publication state per entity (ADR-0002).
create type public.publication_status as enum ('draft', 'published', 'archived');

create type public.surface as enum ('grass', 'synthetic', 'hybrid');

-- Filter label "pitch size" (spec §3).
create type public.pitch_format as enum ('full', 'small_sided', 'training');

create type public.access_class as enum ('public', 'booking_required', 'members_only');

create type public.amenity_key as enum (
  'parking',
  'toilets',
  'changing_rooms',
  'drinking_water',
  'cafe',
  'public_transport'
);

create type public.tri_state as enum ('yes', 'no', 'unknown');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  -- Immutable after first publish (D18); enforced by the publish workflow (PR 2.11).
  slug text not null,
  name text not null,
  street_address text,
  suburb text not null,
  state text not null,
  postcode text,
  -- WGS84 source of truth. Range-checked here because PostGIS silently wraps out-of-range
  -- geography input (e.g. POINT(181 0) becomes POINT(-179 0)), so a CHECK on `location` can't catch it.
  latitude double precision not null,
  longitude double precision not null,
  -- Derived; geography so distances are in metres.
  location extensions.geography(Point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
  ) stored,
  description text,
  -- Nullable: unknown access is stored as NULL, never guessed.
  access public.access_class,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venues_slug_key unique (slug),
  constraint venues_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  constraint venues_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint venues_street_address_length check (street_address is null or char_length(btrim(street_address)) between 1 and 300),
  constraint venues_suburb_length check (char_length(btrim(suburb)) between 1 and 100),
  constraint venues_state_code check (state in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')),
  constraint venues_postcode_format check (postcode is null or postcode ~ '^[0-9]{4}$'),
  constraint venues_description_length check (description is null or char_length(description) <= 5000),
  -- BETWEEN is false for NaN and ±Infinity, so those are rejected too.
  constraint venues_latitude_range check (latitude between -90 and 90),
  constraint venues_longitude_range check (longitude between -180 and 180)
);

-- Public search only reads published venues (ST_DWithin radius queries).
create index venues_location_published_gix on public.venues using gist (location) where status = 'published';

create trigger venues_set_updated_at
before update on public.venues
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pitches
-- ---------------------------------------------------------------------------

create table public.pitches (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  -- Unique within its venue only; immutable after first publish (D18).
  slug text not null,
  name text not null,
  surface public.surface,
  pitch_format public.pitch_format,
  length_m numeric(5, 1),
  width_m numeric(5, 1),
  floodlights boolean,
  -- NULL inherits the venue's access: effective access = COALESCE(pitch.access, venue.access) (D11).
  access public.access_class,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pitches_venue_slug_key unique (venue_id, slug),
  constraint pitches_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  constraint pitches_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint pitches_length_range check (length_m is null or (length_m > 0 and length_m <= 200)),
  constraint pitches_width_range check (width_m is null or (width_m > 0 and width_m <= 150))
);

-- The unique (venue_id, slug) index already covers lookups by venue_id; this one serves the
-- same-pitch EXISTS predicate over published pitches.
create index pitches_published_venue_idx on public.pitches (venue_id) where status = 'published';

create trigger pitches_set_updated_at
before update on public.pitches
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- venue_amenities
-- ---------------------------------------------------------------------------

create table public.venue_amenities (
  venue_id uuid not null references public.venues (id) on delete cascade,
  amenity public.amenity_key not null,
  state public.tri_state not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venue_amenities_pkey primary key (venue_id, amenity)
);

create trigger venue_amenities_set_updated_at
before update on public.venue_amenities
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lock down master tables now; roles and published views arrive in 0003 (ADR-0002).
-- ---------------------------------------------------------------------------

alter table public.venues enable row level security;
alter table public.pitches enable row level security;
alter table public.venue_amenities enable row level security;

revoke all on public.venues, public.pitches, public.venue_amenities from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
