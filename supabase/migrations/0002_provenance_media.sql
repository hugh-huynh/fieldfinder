-- 0002_provenance_media: media rights, provenance, audit history and admin credentials (M2 PR 2.3).
-- Spec §4; ADR-0002, ADR-0003, ADR-0006. Forward-only: never edit this file after merge.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- ADR-0006 / P4. Anything else (e.g. "publicly visible", NC licences) can't be published.
create type public.media_rights_basis as enum (
  'owned',
  'licensed',
  'cc0_public_domain',
  'cc_by',
  'cc_by_sa',
  'written_permission'
);

create type public.source_kind as enum (
  'site_visit',
  'council_record',
  'operator_provided',
  'public_web',
  'other'
);

create type public.confidence_level as enum ('low', 'medium', 'high');

create type public.audit_entity as enum (
  'venue',
  'pitch',
  'venue_amenity',
  'media_asset',
  'field_source',
  'field_verification',
  'admin_api_credential'
);

create type public.audit_action as enum ('create', 'update', 'publish', 'unpublish', 'archive', 'delete');

create type public.publishable_entity as enum ('venue', 'pitch', 'media_asset');

-- ---------------------------------------------------------------------------
-- Append-only guard for audit tables (applies to the table owner too, unlike grants)
-- ---------------------------------------------------------------------------

create function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_api_credentials (ADR-0003)
-- ---------------------------------------------------------------------------

create table public.admin_api_credentials (
  id uuid primary key default gen_random_uuid(),
  -- Operator-facing name, e.g. "import-script-2026-10". Not secret.
  label text not null,
  -- SHA-256 of the bearer token. The token itself is never stored.
  token_hash bytea not null,
  -- Scope vocabulary is defined by the admin auth module (PR 2.9).
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  -- Optional; NULL means any client IP.
  ip_allowlist cidr[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint admin_api_credentials_label_key unique (label),
  constraint admin_api_credentials_token_hash_key unique (token_hash),
  constraint admin_api_credentials_label_format check (label ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and char_length(label) <= 100),
  constraint admin_api_credentials_token_hash_sha256 check (octet_length(token_hash) = 32),
  constraint admin_api_credentials_scopes_present check (
    cardinality(scopes) between 1 and 20
    and array_position(scopes, null) is null
  ),
  -- Forces periodic rotation.
  constraint admin_api_credentials_lifetime check (expires_at > created_at and expires_at <= created_at + interval '1 year'),
  constraint admin_api_credentials_revoked_after_created check (revoked_at is null or revoked_at >= created_at),
  constraint admin_api_credentials_ip_allowlist_present check (ip_allowlist is null or cardinality(ip_allowlist) >= 1)
);

create function public.guard_admin_api_credential_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token_hash is distinct from old.token_hash or new.created_at is distinct from old.created_at then
    raise exception 'token_hash and created_at are immutable; mint a new credential instead' using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked credential cannot be reinstated' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger admin_api_credentials_guard_update
before update on public.admin_api_credentials
for each row execute function public.guard_admin_api_credential_update();

create trigger admin_api_credentials_set_updated_at
before update on public.admin_api_credentials
for each row execute function public.set_updated_at();

-- Scope checks for each element happen here because CHECK can't iterate an array.
create function public.admin_scopes_valid(scopes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(s ~ '^[a-z]+(:[a-z]+)?$'), false) from unnest(scopes) as s;
$$;

alter table public.admin_api_credentials
  add constraint admin_api_credentials_scopes_format check (public.admin_scopes_valid(scopes));

-- ---------------------------------------------------------------------------
-- media_assets (ADR-0006)
-- ---------------------------------------------------------------------------

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one owner. RESTRICT: storage objects must be cleaned up before an owner goes.
  venue_id uuid references public.venues (id) on delete restrict,
  pitch_id uuid references public.pitches (id) on delete restrict,
  -- Object key in the private bucket (re-encoded upload).
  storage_key text not null,
  -- Unguessable key in the public bucket; set only while published (unpublished media has no public URL).
  public_key text,
  content_type text not null,
  width_px integer not null,
  height_px integer not null,
  byte_size integer not null,
  alt_text text not null,
  display_order integer not null default 0,
  status public.publication_status not null default 'draft',

  -- Rights metadata. May be incomplete while draft; complete before publish.
  rights_basis public.media_rights_basis,
  author text,
  source_url text,
  license_name text,
  license_url text,
  attribution_text text,
  -- Pointer to private evidence (licence file, permission email, original capture), never the evidence itself.
  evidence_ref text,
  commercial_use_ok boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint media_assets_storage_key_key unique (storage_key),
  constraint media_assets_public_key_key unique (public_key),
  constraint media_assets_one_owner check (num_nonnulls(venue_id, pitch_id) = 1),
  constraint media_assets_storage_key_format check (
    storage_key ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$' and storage_key !~ '\.\.' and char_length(storage_key) <= 300
  ),
  constraint media_assets_public_key_format check (
    public_key is null or (public_key ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$' and public_key !~ '\.\.' and char_length(public_key) <= 300)
  ),
  -- Uploads are re-encoded by sharp (PR 2.12), so only these output types are stored.
  constraint media_assets_content_type check (content_type in ('image/webp', 'image/avif')),
  constraint media_assets_dimensions check (width_px between 1 and 10000 and height_px between 1 and 10000),
  constraint media_assets_byte_size check (byte_size between 1 and 10485760),
  constraint media_assets_alt_text_length check (char_length(btrim(alt_text)) between 1 and 300),
  constraint media_assets_display_order check (display_order between 0 and 1000),
  constraint media_assets_source_url_format check (source_url is null or source_url ~ '^https?://'),
  constraint media_assets_license_url_format check (license_url is null or license_url ~ '^https?://'),

  -- Only published media has a public object, and every published item has one.
  constraint media_assets_public_key_iff_published check ((status = 'published') = (public_key is not null)),

  -- Publish gate (ADR-0006): rights basis, evidence and commercial use are required,
  -- plus the fields each basis needs for attribution.
  constraint media_assets_publish_rights check (
    status <> 'published'
    or (
      rights_basis is not null
      and commercial_use_ok is true
      and nullif(btrim(evidence_ref), '') is not null
      and (
        rights_basis in ('owned', 'licensed', 'written_permission')
        or (rights_basis = 'cc0_public_domain' and source_url is not null)
        or (
          rights_basis in ('cc_by', 'cc_by_sa')
          and nullif(btrim(author), '') is not null
          and source_url is not null
          and nullif(btrim(license_name), '') is not null
          and license_url is not null
          and nullif(btrim(attribution_text), '') is not null
        )
      )
    )
  ),
  -- Non-commercial licences are never publishable, whatever commercial_use_ok says.
  constraint media_assets_no_nc_license check (
    status <> 'published'
    or license_name is null
    or license_name !~* '(^|[^a-z])nc([^a-z]|$)|non[- ]?commercial'
  )
);

create index media_assets_venue_idx on public.media_assets (venue_id, display_order) where venue_id is not null;
create index media_assets_pitch_idx on public.media_assets (pitch_id, display_order) where pitch_id is not null;

create trigger media_assets_set_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- field_sources: reusable catalogue of where data came from (internal only)
-- ---------------------------------------------------------------------------

create table public.field_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind public.source_kind not null,
  methodology text,
  -- URL or internal document reference.
  reference text,
  -- Licence/rights terms for reusing this source's facts.
  rights_note text,
  collected_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint field_sources_title_length check (char_length(btrim(title)) between 1 and 200)
);

create trigger field_sources_set_updated_at
before update on public.field_sources
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- field_verifications: who/what confirmed a venue or pitch, when, and how sure (internal only)
-- ---------------------------------------------------------------------------

create table public.field_verifications (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues (id) on delete restrict,
  pitch_id uuid references public.pitches (id) on delete restrict,
  source_id uuid references public.field_sources (id) on delete restrict,
  verified_by text not null,
  verified_on date not null,
  evidence text,
  confidence public.confidence_level not null,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint field_verifications_one_subject check (num_nonnulls(venue_id, pitch_id) = 1),
  constraint field_verifications_verified_by_length check (char_length(btrim(verified_by)) between 1 and 100)
);

create index field_verifications_venue_idx on public.field_verifications (venue_id) where venue_id is not null;
create index field_verifications_pitch_idx on public.field_verifications (pitch_id) where pitch_id is not null;
create index field_verifications_source_idx on public.field_verifications (source_id) where source_id is not null;

create trigger field_verifications_set_updated_at
before update on public.field_verifications
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- field_revisions: append-only change audit (no secrets: the admin API writes field diffs only)
-- ---------------------------------------------------------------------------

create table public.field_revisions (
  id bigint generated always as identity primary key,
  entity_type public.audit_entity not null,
  -- For venue_amenity rows this is the venue id.
  entity_id uuid not null,
  action public.audit_action not null,
  -- NULL for operator scripts run directly against the database (e.g. seeding).
  actor_credential_id uuid references public.admin_api_credentials (id) on delete restrict,
  actor_label text not null,
  -- {"field": {"from": ..., "to": ...}}
  changes jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),

  constraint field_revisions_changes_object check (jsonb_typeof(changes) = 'object'),
  constraint field_revisions_actor_label_length check (char_length(btrim(actor_label)) between 1 and 100)
);

create index field_revisions_entity_idx on public.field_revisions (entity_type, entity_id, created_at);

create trigger field_revisions_append_only
before update or delete on public.field_revisions
for each row execute function public.reject_audit_mutation();

create trigger field_revisions_no_truncate
before truncate on public.field_revisions
for each statement execute function public.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- field_publications: append-only publication history. The entity's own `status` column
-- stays the single authoritative state (ADR-0002); this table only records transitions.
-- ---------------------------------------------------------------------------

create table public.field_publications (
  id bigint generated always as identity primary key,
  entity_type public.publishable_entity not null,
  entity_id uuid not null,
  from_status public.publication_status,
  to_status public.publication_status not null,
  actor_credential_id uuid references public.admin_api_credentials (id) on delete restrict,
  actor_label text not null,
  reason text,
  request_id text,
  created_at timestamptz not null default now(),

  constraint field_publications_is_transition check (from_status is distinct from to_status),
  constraint field_publications_actor_label_length check (char_length(btrim(actor_label)) between 1 and 100)
);

create index field_publications_entity_idx on public.field_publications (entity_type, entity_id, created_at);

create trigger field_publications_append_only
before update or delete on public.field_publications
for each row execute function public.reject_audit_mutation();

create trigger field_publications_no_truncate
before truncate on public.field_publications
for each statement execute function public.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Lockdown (ADR-0002): no Data API access to any of this. Roles arrive in 0003.
-- ---------------------------------------------------------------------------

alter table public.admin_api_credentials enable row level security;
alter table public.media_assets enable row level security;
alter table public.field_sources enable row level security;
alter table public.field_verifications enable row level security;
alter table public.field_revisions enable row level security;
alter table public.field_publications enable row level security;

revoke all on
  public.admin_api_credentials,
  public.media_assets,
  public.field_sources,
  public.field_verifications,
  public.field_revisions,
  public.field_publications
from anon, authenticated;

revoke all on sequence public.field_revisions_id_seq, public.field_publications_id_seq from anon, authenticated;

-- Trigger functions only need EXECUTE when the trigger is created, so callers lose nothing.
-- admin_scopes_valid stays executable: a CHECK runs it with the inserting role's privileges.
revoke execute on function
  public.reject_audit_mutation(),
  public.guard_admin_api_credential_update()
from public, anon, authenticated;
