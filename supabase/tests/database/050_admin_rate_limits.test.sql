-- Admin rate-limit counters and admin_rate_limit_hit() (M2 PR 2.9, migration 0005). Rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

grant ff_public_reader, ff_admin_writer to current_user with inherit false, set true;

-- Runs `q` as role `r` and returns 'ok' or the SQLSTATE it raised (same helper as 030).
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

delete from public.admin_rate_limits;

-- ---------------------------------------------------------------------------
-- Privileges: nobody touches the table directly; only the writer may call the function
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('ff_admin_writer', 'select 1 from public.admin_rate_limits'), '42501', 'writer: SELECT on the table is denied');
select is(
  pg_temp.try_as('ff_admin_writer', $$insert into public.admin_rate_limits values ('x', now(), 1, now() + interval '1 minute')$$),
  '42501',
  'writer: INSERT on the table is denied'
);
select is(pg_temp.try_as('ff_public_reader', 'select 1 from public.admin_rate_limits'), '42501', 'reader: SELECT on the table is denied');
select is(pg_temp.try_as('anon', 'select 1 from public.admin_rate_limits'), '42501', 'anon: SELECT on the table is denied');
select is(pg_temp.try_as('service_role', 'select 1 from public.admin_rate_limits'), '42501', 'service_role: SELECT on the table is denied');
select is(
  pg_temp.try_as('ff_public_reader', $$select * from public.admin_rate_limit_hit('t.priv:x', 60, 5)$$),
  '42501',
  'reader cannot execute admin_rate_limit_hit'
);
select is(
  pg_temp.try_as('anon', $$select * from public.admin_rate_limit_hit('t.priv:x', 60, 5)$$),
  '42501',
  'anon cannot execute admin_rate_limit_hit'
);
select is(
  pg_temp.try_as('authenticated', $$select * from public.admin_rate_limit_hit('t.priv:x', 60, 5)$$),
  '42501',
  'authenticated cannot execute admin_rate_limit_hit'
);
select is(
  pg_temp.try_as('service_role', $$select * from public.admin_rate_limit_hit('t.priv:x', 60, 5)$$),
  '42501',
  'service_role cannot execute admin_rate_limit_hit'
);
select is(
  pg_temp.try_as('ff_admin_writer', $$select * from public.admin_rate_limit_hit('t.priv:x', 60, 5)$$),
  'ok',
  'writer can execute admin_rate_limit_hit'
);

-- ---------------------------------------------------------------------------
-- Counting (now() is fixed for the transaction, so every call lands in the same window)
-- ---------------------------------------------------------------------------

select is((select row(allowed, hits)::text from public.admin_rate_limit_hit('t.count:a', 60, 2)), '(t,1)', 'first hit is allowed');
select is((select row(allowed, hits)::text from public.admin_rate_limit_hit('t.count:a', 60, 2)), '(t,2)', 'the limit-th hit is still allowed');
select is((select row(allowed, hits)::text from public.admin_rate_limit_hit('t.count:a', 60, 2)), '(f,3)', 'the hit after the limit is blocked');

select is((select row(allowed, hits)::text from public.admin_rate_limit_hit('t.count:a', 60, 2, 0)), '(f,3)', 'cost 0 reports a full bucket as blocked');
select is((select hits from public.admin_rate_limit_hit('t.count:a', 60, 2, 0)), 3, 'cost 0 does not count');
select is((select row(allowed, hits)::text from public.admin_rate_limit_hit('t.count:fresh', 60, 2, 0)), '(t,0)', 'cost 0 on an empty bucket is allowed');

select ok(
  (select reset_at > now() and reset_at <= now() + interval '60 seconds' from public.admin_rate_limit_hit('t.count:b', 60, 5)),
  'reset_at is the end of the current window'
);

-- ---------------------------------------------------------------------------
-- Input validation and housekeeping
-- ---------------------------------------------------------------------------

select throws_ok($$select * from public.admin_rate_limit_hit('Bad Key!', 60, 1)$$, '22023', null, 'a bucket outside the key format is rejected');
select throws_ok($$select * from public.admin_rate_limit_hit('t.v:a', 0, 1)$$, '22023', null, 'a zero window is rejected');
select throws_ok($$select * from public.admin_rate_limit_hit('t.v:a', 3601, 1)$$, '22023', null, 'a window over an hour is rejected');
select throws_ok($$select * from public.admin_rate_limit_hit('t.v:a', 60, 0)$$, '22023', null, 'a zero limit is rejected');
select throws_ok($$select * from public.admin_rate_limit_hit('t.v:a', 60, 1, -1)$$, '22023', null, 'a negative cost is rejected');

insert into public.admin_rate_limits values ('t.old:a', now() - interval '2 hours', 5, now() - interval '1 hour');
select * from public.admin_rate_limit_hit('t.purge:a', 60, 5);
select ok(not exists (select 1 from public.admin_rate_limits where bucket = 't.old:a'), 'expired windows are purged by later calls');

select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'admin_rate_limit_hit'),
  'admin_rate_limit_hit is SECURITY DEFINER with an empty search_path'
);

select * from finish();
rollback;
