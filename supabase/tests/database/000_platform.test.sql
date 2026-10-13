-- Platform smoke test (M2 PR 2.1): the local stack runs Postgres 17 and PostGIS works.
-- Everything runs inside a rolled-back transaction, so no extension or object persists.
begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists postgis with schema extensions;

select plan(3);

select ok(
  current_setting('server_version_num')::int >= 170000,
  'Postgres major version is 17 or later'
);

select ok(
  exists (select 1 from pg_extension where extname = 'postgis'),
  'PostGIS extension can be installed'
);

-- 0.01 degrees of latitude near Melbourne is roughly 1.11 km on the WGS84 spheroid.
select ok(
  extensions.st_distance(
    'SRID=4326;POINT(144.9631 -37.8136)'::extensions.geography,
    'SRID=4326;POINT(144.9631 -37.8236)'::extensions.geography
  ) between 1100 and 1120,
  'geography distance is computed in metres'
);

select * from finish();

rollback;
