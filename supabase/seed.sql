-- GENERATED FILE: do not edit by hand.
-- Source: tests/fixtures/venues.ts · Regenerate: pnpm seed:generate
-- Synthetic data for local development and tests only. Never load this into staging or production.

insert into public.field_sources (id, title, kind, methodology, reference, rights_note, collected_on) values
  ('5eed0000-0000-4000-8003-000000000001', 'Synthetic site visit log', 'site_visit', 'Walked each fixture venue (fictional) ff-private-sentinel', 'internal/ff-private-sentinel/visits', 'Own observations', '2026-09-01');

insert into public.venues (id, slug, name, street_address, suburb, state, postcode, latitude, longitude, description, access, status) values
  ('5eed0000-0000-4000-8000-000000000001', 'wattlebird-reserve', 'Wattlebird Reserve', '1 Example Parade', 'Carlton North', 'VIC', '3054', -37.784, 144.972, 'Synthetic fixture venue with one floodlit synthetic pitch.', 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000002', 'ironbark-park', 'Ironbark Park', '20 Sample Street', 'Fitzroy North', 'VIC', '3068', -37.781, 144.986, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000003', 'banksias-corner-reserve', 'Banksia''s Corner Reserve', null, 'Brunswick', 'VIC', '3056', -37.768, 144.96, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000004', 'lilly-pilly-fields', 'Lilly Pilly Fields ff-private-sentinel', null, 'Northcote', 'VIC', null, -37.77, 145, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000005', 'hidden-draft-park', 'Hidden Draft Park ff-private-sentinel', null, 'Richmond', 'VIC', null, -37.823, 144.998, null, 'public', 'draft'),
  ('5eed0000-0000-4000-8000-000000000006', 'old-mill-oval', 'Old Mill Oval ff-private-sentinel', null, 'Collingwood', 'VIC', null, -37.802, 144.988, null, 'public', 'archived'),
  ('5eed0000-0000-4000-8000-000000000007', 'paperbark-common', 'Paperbark Common', null, 'Parkville', 'VIC', null, -37.79, 144.951, null, null, 'published'),
  ('5eed0000-0000-4000-8000-000000000008', 'kurrajong-recreation-ground', 'Kurrajong Recreation Ground', null, 'South Yarra', 'VIC', '3141', -37.838, 144.992, null, 'booking_required', 'published'),
  ('5eed0000-0000-4000-8000-000000000009', 'saltbush-sports-park', 'Saltbush Sports Park', null, 'Footscray', 'VIC', '3011', -37.8, 144.9, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000010', 'coastal-heath-reserve', 'Coastal Heath Reserve', null, 'Elwood', 'VIC', '3184', -37.882, 144.985, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000011', 'red-gum-flats', 'Red Gum Flats', null, 'Box Hill', 'VIC', null, -37.819, 145.122, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000012', 'grey-box-fields', 'Grey Box Fields', null, 'Ringwood', 'VIC', null, -37.815, 145.229, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000013', 'tea-tree-point', 'Tea Tree Point', null, 'Frankston', 'VIC', null, -38.144, 145.126, null, 'public', 'published'),
  ('5eed0000-0000-4000-8000-000000000014', 'far-plains-oval', 'Far Plains Oval', null, 'Geelong', 'VIC', null, -38.149, 144.36, null, 'public', 'published');

insert into public.venue_amenities (venue_id, amenity, state) values
  ('5eed0000-0000-4000-8000-000000000001', 'cafe', 'no'),
  ('5eed0000-0000-4000-8000-000000000001', 'drinking_water', 'unknown'),
  ('5eed0000-0000-4000-8000-000000000001', 'parking', 'yes'),
  ('5eed0000-0000-4000-8000-000000000001', 'toilets', 'yes'),
  ('5eed0000-0000-4000-8000-000000000002', 'cafe', 'no'),
  ('5eed0000-0000-4000-8000-000000000002', 'changing_rooms', 'yes'),
  ('5eed0000-0000-4000-8000-000000000002', 'parking', 'unknown'),
  ('5eed0000-0000-4000-8000-000000000002', 'toilets', 'yes'),
  ('5eed0000-0000-4000-8000-000000000003', 'public_transport', 'yes'),
  ('5eed0000-0000-4000-8000-000000000003', 'toilets', 'no'),
  ('5eed0000-0000-4000-8000-000000000008', 'changing_rooms', 'unknown'),
  ('5eed0000-0000-4000-8000-000000000008', 'parking', 'yes'),
  ('5eed0000-0000-4000-8000-000000000009', 'drinking_water', 'yes'),
  ('5eed0000-0000-4000-8000-000000000009', 'parking', 'yes'),
  ('5eed0000-0000-4000-8000-000000000009', 'toilets', 'yes'),
  ('5eed0000-0000-4000-8000-000000000010', 'cafe', 'yes'),
  ('5eed0000-0000-4000-8000-000000000010', 'toilets', 'yes');

insert into public.pitches (id, venue_id, slug, name, surface, pitch_format, length_m, width_m, floodlights, access, status) values
  ('5eed0000-0000-4000-8001-000000000001', '5eed0000-0000-4000-8000-000000000001', 'main-pitch', 'Main Pitch', 'synthetic', 'full', 105, 68, true, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000002', '5eed0000-0000-4000-8000-000000000002', 'pitch-a', 'Pitch A', 'synthetic', 'full', null, null, false, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000003', '5eed0000-0000-4000-8000-000000000002', 'pitch-b', 'Pitch B', 'grass', 'full', null, null, true, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000004', '5eed0000-0000-4000-8000-000000000002', 'pitch-c', 'Pitch C', 'hybrid', 'small_sided', null, null, true, 'members_only', 'published'),
  ('5eed0000-0000-4000-8001-000000000021', '5eed0000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8001-000000000002', 'Pitch D', null, null, null, null, null, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000005', '5eed0000-0000-4000-8000-000000000003', 'north-pitch', 'North Pitch', 'grass', 'small_sided', null, null, false, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000006', '5eed0000-0000-4000-8000-000000000003', 'draft-pitch', 'Draft Pitch ff-private-sentinel', 'synthetic', null, null, null, null, null, 'draft'),
  ('5eed0000-0000-4000-8001-000000000007', '5eed0000-0000-4000-8000-000000000004', 'pitch-1', 'Pitch 1', 'grass', null, null, null, null, null, 'draft'),
  ('5eed0000-0000-4000-8001-000000000008', '5eed0000-0000-4000-8000-000000000005', 'pitch-1', 'Pitch 1', 'synthetic', null, null, null, true, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000009', '5eed0000-0000-4000-8000-000000000006', 'pitch-1', 'Pitch 1', 'grass', null, null, null, null, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000010', '5eed0000-0000-4000-8000-000000000007', 'open-field', 'Open Field', null, null, null, null, null, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000011', '5eed0000-0000-4000-8000-000000000008', 'oval-1', 'Oval 1', 'grass', 'full', null, null, true, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000012', '5eed0000-0000-4000-8000-000000000008', 'oval-2', 'Oval 2', 'grass', 'training', null, null, false, 'members_only', 'published'),
  ('5eed0000-0000-4000-8001-000000000013', '5eed0000-0000-4000-8000-000000000009', 'east-pitch', 'East Pitch', 'synthetic', 'small_sided', null, null, true, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000014', '5eed0000-0000-4000-8000-000000000009', 'west-pitch', 'West Pitch', 'grass', 'full', null, null, false, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000020', '5eed0000-0000-4000-8000-000000000009', 'old-pitch', 'Old Pitch ff-private-sentinel', 'grass', null, null, null, null, null, 'archived'),
  ('5eed0000-0000-4000-8001-000000000015', '5eed0000-0000-4000-8000-000000000010', 'beach-pitch', 'Beach Pitch', 'grass', 'full', null, null, null, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000016', '5eed0000-0000-4000-8000-000000000011', 'pitch-1', 'Pitch 1', 'synthetic', 'full', null, null, true, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000017', '5eed0000-0000-4000-8000-000000000012', 'pitch-1', 'Pitch 1', 'grass', 'full', null, null, null, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000018', '5eed0000-0000-4000-8000-000000000013', 'pitch-1', 'Pitch 1', 'hybrid', 'full', null, null, true, null, 'published'),
  ('5eed0000-0000-4000-8001-000000000019', '5eed0000-0000-4000-8000-000000000014', 'pitch-1', 'Pitch 1', 'grass', 'full', null, null, null, null, 'published');

insert into public.media_assets (id, venue_id, pitch_id, storage_key, public_key, content_type, width_px, height_px, byte_size, alt_text, display_order, status, rights_basis, author, source_url, license_name, license_url, attribution_text, evidence_ref, commercial_use_ok) values
  ('5eed0000-0000-4000-8002-000000000001', '5eed0000-0000-4000-8000-000000000001', null, 'fixtures/1.webp', 'fixtures/public/5eed0000-0000-4000-8002-000000000001.webp', 'image/webp', 1600, 1067, 240000, 'Entrance gates and car park', 0, 'published', 'owned', null, null, null, null, null, 'fixtures/evidence/1', true),
  ('5eed0000-0000-4000-8002-000000000002', '5eed0000-0000-4000-8000-000000000001', null, 'private/ff-private-sentinel/2.webp', null, 'image/webp', 1600, 1067, 240000, 'Unpublished image ff-private-sentinel', 1, 'draft', null, null, null, null, null, null, null, null),
  ('5eed0000-0000-4000-8002-000000000004', '5eed0000-0000-4000-8000-000000000002', null, 'fixtures/4.webp', 'fixtures/public/5eed0000-0000-4000-8002-000000000004.webp', 'image/webp', 1600, 1067, 240000, 'Three pitches seen from the pavilion', 0, 'published', 'owned', null, null, null, null, null, 'fixtures/evidence/4', true),
  ('5eed0000-0000-4000-8002-000000000005', '5eed0000-0000-4000-8000-000000000002', null, 'fixtures/5.webp', 'fixtures/public/5eed0000-0000-4000-8002-000000000005.webp', 'image/webp', 1600, 1067, 240000, 'Goalmouth in afternoon light', 1, 'published', 'cc_by', 'Example Photographer', 'https://example.org/photos/goalmouth', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'Photo: Example Photographer, CC BY 4.0', 'evidence/ff-private-sentinel/cc-by-5', true),
  ('5eed0000-0000-4000-8002-000000000006', '5eed0000-0000-4000-8000-000000000005', null, 'private/ff-private-sentinel/6.webp', null, 'image/webp', 1600, 1067, 240000, 'Draft venue image', 0, 'draft', null, null, null, null, null, null, null, null),
  ('5eed0000-0000-4000-8002-000000000007', '5eed0000-0000-4000-8000-000000000009', null, 'fixtures/7.webp', 'fixtures/public/5eed0000-0000-4000-8002-000000000007.webp', 'image/webp', 1600, 1067, 240000, 'Two pitches beside the river path', 0, 'published', 'owned', null, null, null, null, null, 'fixtures/evidence/7', true),
  ('5eed0000-0000-4000-8002-000000000003', null, '5eed0000-0000-4000-8001-000000000001', 'fixtures/3.webp', 'fixtures/public/5eed0000-0000-4000-8002-000000000003.webp', 'image/webp', 1600, 1067, 240000, 'Floodlit synthetic pitch at night', 0, 'published', 'owned', null, null, null, null, null, 'fixtures/evidence/3', true);

insert into public.field_verifications (id, venue_id, pitch_id, source_id, verified_by, verified_on, evidence, confidence, internal_notes) values
  ('5eed0000-0000-4000-8004-000000000001', '5eed0000-0000-4000-8000-000000000001', null, '5eed0000-0000-4000-8003-000000000001', 'fixture-operator', '2026-09-01', 'Photo set ff-private-sentinel', 'high', 'Internal note ff-private-sentinel');
