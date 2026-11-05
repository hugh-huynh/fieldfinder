-- Idempotency-Key storage for admin mutations (M2 PR 2.10, migration 0006). Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

grant ff_public_reader, ff_admin_writer to current_user with inherit false, set true;

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

insert into public.admin_api_credentials (id, label, token_hash, scopes, expires_at)
values ('00000000-0000-4000-a000-000000000001', 'pgtap-idem', decode(repeat('ab', 32), 'hex'), array['venues:write'],
        now() + interval '30 days');

-- Shorthand: begin a claim with credential 1 and return "state/status".
create function pg_temp.claim(k text, route text, h text)
returns text
language sql
as $$
  select state || '/' || coalesce(response_status::text, '-')
  from public.admin_idempotency_begin('00000000-0000-4000-a000-000000000001', k, route, decode(h, 'hex'))
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('ff_admin_writer', 'select 1 from public.admin_idempotency_keys'), '42501', 'writer: SELECT on the table is denied');
select is(
  pg_temp.try_as('ff_admin_writer', $$update public.admin_idempotency_keys set response_status = 200$$),
  '42501',
  'writer: UPDATE on the table is denied'
);
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.admin_idempotency_keys'), '42501', 'reader: SELECT on the table is denied');
select is(pg_temp.try_as('service_role', 'select 1 from public.admin_idempotency_keys'), '42501', 'service_role: SELECT on the table is denied');
select is(
  pg_temp.try_as('ff_public_reader', $$select pg_temp.claim('priv-key-1', 'POST /x', repeat('00', 32))$$),
  '42501',
  'reader cannot execute admin_idempotency_begin'
);
select is(
  pg_temp.try_as('anon', $$select pg_temp.claim('priv-key-1', 'POST /x', repeat('00', 32))$$),
  '42501',
  'anon cannot execute admin_idempotency_begin'
);
select is(
  pg_temp.try_as('authenticated', $$select public.admin_idempotency_finish('00000000-0000-4000-a000-000000000001', 'priv-key-1', 200::smallint, '{}', '{}')$$),
  '42501',
  'authenticated cannot execute admin_idempotency_finish'
);
select is(
  pg_temp.try_as('ff_admin_writer', $$select pg_temp.claim('priv-key-2', 'POST /x', repeat('00', 32))$$),
  'ok',
  'writer can execute admin_idempotency_begin'
);

-- ---------------------------------------------------------------------------
-- Claim, finish, replay, mismatch
-- ---------------------------------------------------------------------------

select is(pg_temp.claim('key-aaaa-1', 'POST /api/admin/venues', repeat('11', 32)), 'new/-', 'a fresh key is claimed');
select is(
  pg_temp.claim('key-aaaa-1', 'POST /api/admin/venues', repeat('11', 32)),
  'mismatch/-',
  'a claim with no stored response yet is never replayed'
);

select lives_ok(
  $$select public.admin_idempotency_finish('00000000-0000-4000-a000-000000000001', 'key-aaaa-1', 201::smallint,
      '{"etag": "\"1\""}', '{"venue": {"id": "v1"}}')$$,
  'finish stores the response'
);
select is(pg_temp.claim('key-aaaa-1', 'POST /api/admin/venues', repeat('11', 32)), 'replay/201', 'the same request replays it');
select is(
  (select response_body from public.admin_idempotency_begin('00000000-0000-4000-a000-000000000001', 'key-aaaa-1',
     'POST /api/admin/venues', decode(repeat('11', 32), 'hex'))),
  '{"venue": {"id": "v1"}}'::jsonb,
  'the replay carries the stored body'
);
select is(pg_temp.claim('key-aaaa-1', 'POST /api/admin/venues', repeat('22', 32)), 'mismatch/-', 'a different body under the same key is a mismatch');
select is(pg_temp.claim('key-aaaa-1', 'PATCH /api/admin/venues/1', repeat('11', 32)), 'mismatch/-', 'another endpoint under the same key is a mismatch');

select throws_ok(
  $$select public.admin_idempotency_finish('00000000-0000-4000-a000-000000000001', 'key-aaaa-1', 200::smallint, '{}', '{}')$$,
  '22023', null, 'a key can only be finished once'
);
select throws_ok(
  $$select public.admin_idempotency_finish('00000000-0000-4000-a000-000000000001', 'never-claimed', 200::smallint, '{}', '{}')$$,
  '22023', null, 'finishing an unclaimed key is rejected'
);

-- ---------------------------------------------------------------------------
-- Validation and expiry
-- ---------------------------------------------------------------------------

select throws_ok($$select pg_temp.claim('short', 'POST /x', repeat('00', 32))$$, '22023', null, 'a key under 8 characters is rejected');
select throws_ok($$select pg_temp.claim('key-with space', 'POST /x', repeat('00', 32))$$, '22023', null, 'a key with a space is rejected');

update public.admin_idempotency_keys
set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
where idempotency_key = 'key-aaaa-1';
select is(pg_temp.claim('key-aaaa-1', 'POST /api/admin/venues', repeat('33', 32)), 'new/-', 'an expired key can be claimed again, for any request');

select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
   where proname in ('admin_idempotency_begin', 'admin_idempotency_finish')),
  'both functions are SECURITY DEFINER with an empty search_path'
);

select * from finish();
rollback;
