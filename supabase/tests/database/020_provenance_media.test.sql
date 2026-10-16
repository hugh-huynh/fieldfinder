-- Provenance, media rights, audit history and admin credentials (M2 PR 2.3, migration 0002).
-- Synthetic data only; rolled back.
begin;

create extension if not exists pgtap with schema extensions;

-- Start from an empty content set so results never depend on supabase/seed.sql (rolled back).
delete from public.field_verifications;
delete from public.field_sources;
delete from public.media_assets;
delete from public.venue_amenities;
delete from public.pitches;
delete from public.venues;

select plan(49);

-- ---------------------------------------------------------------------------
-- Structure and lockdown
-- ---------------------------------------------------------------------------

select has_table('public', 'media_assets', 'media_assets table exists');
select has_table('public', 'field_sources', 'field_sources table exists');
select has_table('public', 'field_verifications', 'field_verifications table exists');
select has_table('public', 'field_revisions', 'field_revisions table exists');
select has_table('public', 'field_publications', 'field_publications table exists');
select has_table('public', 'admin_api_credentials', 'admin_api_credentials table exists');

select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.media_assets'::regclass, 'public.field_sources'::regclass, 'public.field_verifications'::regclass,
    'public.field_revisions'::regclass, 'public.field_publications'::regclass, 'public.admin_api_credentials'::regclass
  )),
  'row level security is enabled on every new table'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in ('media_assets', 'field_sources', 'field_verifications',
                         'field_revisions', 'field_publications', 'admin_api_credentials')
  ),
  'anon and authenticated have no privileges on any new table'
);

select ok(
  not has_sequence_privilege('anon', 'public.field_revisions_id_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.field_publications_id_seq', 'usage'),
  'anon and authenticated cannot use the audit sequences'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.venues (id, slug, name, suburb, state, latitude, longitude) values
  ('00000000-0000-4000-8000-000000000001', 'test-reserve', 'Test Reserve', 'Testville', 'VIC', -37.81, 144.96),
  ('00000000-0000-4000-8000-000000000002', 'media-only-park', 'Media Only Park', 'Testville', 'VIC', -37.80, 144.95);

insert into public.pitches (id, venue_id, slug, name)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'pitch-1', 'Pitch 1');

-- ---------------------------------------------------------------------------
-- media_assets: ownership and file metadata
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.media_assets (venue_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000002', 'venues/a/1.webp', 'image/webp', 1600, 900, 250000, 'Goal end at dusk')$$,
  'a draft venue image without rights metadata can be stored privately'
);

select lives_ok(
  $$insert into public.media_assets (pitch_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-0000000000a1', 'pitches/a/1.avif', 'image/avif', 1600, 900, 250000, 'Centre circle')$$,
  'a pitch can own an image'
);

select throws_ok(
  $$insert into public.media_assets (storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('none/1.webp', 'image/webp', 10, 10, 10, 'x')$$,
  '23514', null, 'media with no owner is rejected'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, pitch_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'both/1.webp', 'image/webp', 10, 10, 10, 'x')$$,
  '23514', null, 'media with two owners is rejected'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', 'svg/1.svg', 'image/svg+xml', 10, 10, 10, 'x')$$,
  '23514', null, 'only re-encoded WebP/AVIF content types are stored'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', 'big/1.webp', 'image/webp', 10, 10, 10485761, 'x')$$,
  '23514', null, 'files over 10 MiB are rejected'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', 'alt/1.webp', 'image/webp', 10, 10, 10, '  ')$$,
  '23514', null, 'alt text is required'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', 'venues/../secret.webp', 'image/webp', 10, 10, 10, 'x')$$,
  '23514', null, 'storage keys cannot contain path traversal'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', 'venues/a/1.webp', 'image/webp', 10, 10, 10, 'x')$$,
  '23505', null, 'storage keys are unique'
);

-- ---------------------------------------------------------------------------
-- media_assets: publish gate (ADR-0006)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, public_key, status, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', 'p/no-rights.webp', 'pub/no-rights', 'published', 'image/webp', 10, 10, 10, 'x')$$,
  '23514', null, 'publishing without rights metadata is blocked'
);

select lives_ok(
  $$insert into public.media_assets (venue_id, storage_key, public_key, status, content_type, width_px, height_px, byte_size, alt_text,
                                     rights_basis, evidence_ref, commercial_use_ok)
    values ('00000000-0000-4000-8000-000000000001', 'p/owned.webp', 'pub/owned', 'published', 'image/webp', 10, 10, 10, 'x',
            'owned', 'evidence/originals/IMG_0001', true)$$,
  'an owned image with evidence and commercial use can be published'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, status, content_type, width_px, height_px, byte_size, alt_text,
                                     rights_basis, evidence_ref, commercial_use_ok)
    values ('00000000-0000-4000-8000-000000000001', 'p/no-public-key.webp', 'published', 'image/webp', 10, 10, 10, 'x',
            'owned', 'evidence/originals/IMG_0002', true)$$,
  '23514', null, 'published media must have a public object key'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, public_key, content_type, width_px, height_px, byte_size, alt_text)
    values ('00000000-0000-4000-8000-000000000001', 'p/draft-public.webp', 'pub/draft-public', 'image/webp', 10, 10, 10, 'x')$$,
  '23514', null, 'unpublished media cannot have a public object key'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, public_key, status, content_type, width_px, height_px, byte_size, alt_text,
                                     rights_basis, author, source_url, license_name, license_url, evidence_ref, commercial_use_ok)
    values ('00000000-0000-4000-8000-000000000001', 'p/ccby-noattr.webp', 'pub/ccby-noattr', 'published', 'image/webp', 10, 10, 10, 'x',
            'cc_by', 'A. Photographer', 'https://example.org/photo', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
            'evidence/ccby-1', true)$$,
  '23514', null, 'CC BY media without attribution text cannot be published'
);

select lives_ok(
  $$insert into public.media_assets (venue_id, storage_key, public_key, status, content_type, width_px, height_px, byte_size, alt_text,
                                     rights_basis, author, source_url, license_name, license_url, attribution_text, evidence_ref, commercial_use_ok)
    values ('00000000-0000-4000-8000-000000000001', 'p/ccby.webp', 'pub/ccby', 'published', 'image/webp', 10, 10, 10, 'x',
            'cc_by', 'A. Photographer', 'https://example.org/photo', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
            'Photo: A. Photographer, CC BY 4.0', 'evidence/ccby-2', true)$$,
  'CC BY media with complete attribution can be published'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, public_key, status, content_type, width_px, height_px, byte_size, alt_text,
                                     rights_basis, evidence_ref, commercial_use_ok)
    values ('00000000-0000-4000-8000-000000000001', 'p/no-commercial.webp', 'pub/no-commercial', 'published', 'image/webp', 10, 10, 10, 'x',
            'licensed', 'evidence/licence-3', false)$$,
  '23514', null, 'media without commercial-use rights cannot be published'
);

select throws_ok(
  $$insert into public.media_assets (venue_id, storage_key, public_key, status, content_type, width_px, height_px, byte_size, alt_text,
                                     rights_basis, author, source_url, license_name, license_url, attribution_text, evidence_ref, commercial_use_ok)
    values ('00000000-0000-4000-8000-000000000001', 'p/nc.webp', 'pub/nc', 'published', 'image/webp', 10, 10, 10, 'x',
            'cc_by', 'A. Photographer', 'https://example.org/photo', 'CC BY-NC 4.0', 'https://creativecommons.org/licenses/by-nc/4.0/',
            'Photo: A. Photographer, CC BY-NC 4.0', 'evidence/nc-1', true)$$,
  '23514', null, 'non-commercial (NC) licences cannot be published even if commercial_use_ok is set'
);

select throws_ok(
  $$delete from public.venues where id = '00000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'a venue with media cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- field_sources / field_verifications
-- ---------------------------------------------------------------------------

insert into public.field_sources (id, title, kind)
values ('00000000-0000-4000-8000-0000000000c1', 'Site visit, spring 2026', 'site_visit');

select lives_ok(
  $$insert into public.field_verifications (venue_id, source_id, verified_by, verified_on, confidence)
    values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'operator', '2026-10-01', 'high')$$,
  'a venue verification can reference a source'
);

select throws_ok(
  $$insert into public.field_verifications (verified_by, verified_on, confidence) values ('operator', '2026-10-01', 'low')$$,
  '23514', null, 'a verification must have a subject'
);

select throws_ok(
  $$insert into public.field_verifications (venue_id, pitch_id, verified_by, verified_on, confidence)
    values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'operator', '2026-10-01', 'low')$$,
  '23514', null, 'a verification cannot have two subjects'
);

-- ---------------------------------------------------------------------------
-- admin_api_credentials (ADR-0003)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.admin_api_credentials (id, label, token_hash, scopes, expires_at)
    values ('00000000-0000-4000-8000-0000000000d1', 'import-script', sha256('synthetic-token-1'::bytea), array['venues:write'], now() + interval '90 days')$$,
  'a hashed, scoped, expiring credential can be stored'
);

select throws_ok(
  $$insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values ('short-hash', '\x00112233445566778899aabbccddeeff'::bytea, array['venues:write'], now() + interval '1 day')$$,
  '23514', null, 'token_hash must be a 32-byte SHA-256 digest'
);

select throws_ok(
  $$insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values ('too-long', sha256('synthetic-token-2'::bytea), array['venues:write'], now() + interval '366 days')$$,
  '23514', null, 'credentials cannot live longer than one year'
);

select throws_ok(
  $$insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values ('expired', sha256('synthetic-token-3'::bytea), array['venues:write'], now() - interval '1 day')$$,
  '23514', null, 'credentials cannot be created already expired'
);

select throws_ok(
  $$insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values ('no-scopes', sha256('synthetic-token-4'::bytea), array[]::text[], now() + interval '1 day')$$,
  '23514', null, 'credentials need at least one scope'
);

select throws_ok(
  $$insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values ('bad-scope', sha256('synthetic-token-5'::bytea), array['Venues Write'], now() + interval '1 day')$$,
  '23514', null, 'malformed scopes are rejected'
);

select throws_ok(
  $$insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values ('dup-hash', sha256('synthetic-token-1'::bytea), array['venues:write'], now() + interval '1 day')$$,
  '23505', null, 'token hashes are unique'
);

select throws_ok(
  $$update public.admin_api_credentials set token_hash = sha256('synthetic-token-6'::bytea)
    where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'token_hash cannot be changed after creation'
);

select lives_ok(
  $$update public.admin_api_credentials set revoked_at = now() where id = '00000000-0000-4000-8000-0000000000d1'$$,
  'a credential can be revoked'
);

select throws_ok(
  $$update public.admin_api_credentials set revoked_at = null where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '42501', null, 'a revoked credential cannot be reinstated'
);

-- ---------------------------------------------------------------------------
-- field_revisions: append-only
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.field_revisions (entity_type, entity_id, action, actor_credential_id, actor_label, changes)
    values ('venue', '00000000-0000-4000-8000-000000000001', 'update', '00000000-0000-4000-8000-0000000000d1', 'import-script',
            '{"name": {"from": "Old", "to": "Test Reserve"}}')$$,
  'a revision can be appended'
);

select throws_ok(
  $$update public.field_revisions set actor_label = 'someone-else'$$,
  '42501', null, 'revisions cannot be updated'
);

select throws_ok(
  $$delete from public.field_revisions$$,
  '42501', null, 'revisions cannot be deleted'
);

select throws_ok(
  $$truncate public.field_revisions$$,
  '42501', null, 'revisions cannot be truncated'
);

select throws_ok(
  $$insert into public.field_revisions (entity_type, entity_id, action, actor_label, changes)
    values ('venue', '00000000-0000-4000-8000-000000000001', 'update', 'import-script', '["not", "an", "object"]')$$,
  '23514', null, 'revision changes must be a JSON object'
);

-- ---------------------------------------------------------------------------
-- field_publications: append-only
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.field_publications (entity_type, entity_id, from_status, to_status, actor_label)
    values ('venue', '00000000-0000-4000-8000-000000000001', 'draft', 'published', 'import-script')$$,
  'a publication transition can be recorded'
);

select throws_ok(
  $$update public.field_publications set reason = 'edited'$$,
  '42501', null, 'publication history cannot be updated'
);

select throws_ok(
  $$delete from public.field_publications$$,
  '42501', null, 'publication history cannot be deleted'
);

select throws_ok(
  $$insert into public.field_publications (entity_type, entity_id, from_status, to_status, actor_label)
    values ('venue', '00000000-0000-4000-8000-000000000001', 'published', 'published', 'import-script')$$,
  '23514', null, 'a publication record must be a real transition'
);

select * from finish();

rollback;
