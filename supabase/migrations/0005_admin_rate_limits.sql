-- 0005_admin_rate_limits: fixed-window counters for the admin API rate limiter (M2 PR 2.9).
-- ADR-0004 (D5 revised 2026-10-20, option B): public routes are limited by Vercel Firewall rules at
-- the edge; admin routes add this app-level limiter per credential and per client for failed auth.
-- Forward-only: never edit this file after merge.
--
-- ff_admin_writer gets EXECUTE on admin_rate_limit_hit() only, never the table itself. Bucket keys
-- are built and hashed by the app (src/lib/rate-limit), so no raw IP address is stored. Rows live
-- for one window and are purged by later calls.

create table public.admin_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null,
  expires_at timestamptz not null,

  constraint admin_rate_limits_pkey primary key (bucket, window_start),
  constraint admin_rate_limits_bucket_format check (bucket ~ '^[a-z0-9_.:-]{1,200}$'),
  constraint admin_rate_limits_hits_nonnegative check (hits >= 0),
  constraint admin_rate_limits_expiry_after_start check (expires_at > window_start)
);

create index admin_rate_limits_expires_at_idx on public.admin_rate_limits (expires_at);

alter table public.admin_rate_limits enable row level security;
revoke all on public.admin_rate_limits from public, anon, authenticated, service_role, ff_public_reader, ff_admin_writer;

-- ---------------------------------------------------------------------------
-- admin_rate_limit_hit(): count `p_cost` hits against `p_bucket` in the current fixed window.
--
-- p_cost = 0 only reads the count ("is this bucket already full?"); allowed is then hits < limit.
-- p_cost > 0 adds the hits first; allowed is then hits <= limit, so the limit-th hit still passes.
-- reset_at is when the current window ends (the API's Retry-After). Bad input raises 22023.
-- ---------------------------------------------------------------------------

create function public.admin_rate_limit_hit(
  p_bucket text,
  p_window_seconds integer,
  p_limit integer,
  p_cost integer default 1
)
returns table (allowed boolean, hits integer, reset_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9_.:-]{1,200}$' then
    raise exception 'invalid p_bucket' using errcode = '22023';
  end if;
  if not coalesce(p_window_seconds between 1 and 3600, false) then
    raise exception 'invalid p_window_seconds' using errcode = '22023';
  end if;
  if not coalesce(p_limit between 1 and 100000, false) then
    raise exception 'invalid p_limit' using errcode = '22023';
  end if;
  if not coalesce(p_cost between 0 and 1000, false) then
    raise exception 'invalid p_cost' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  -- Purge a bounded batch of expired windows so the table stays small without a scheduled job.
  delete from public.admin_rate_limits
  where ctid in (
    select ctid from public.admin_rate_limits where expires_at < now() limit 100
  );

  if p_cost = 0 then
    select r.hits into v_hits
    from public.admin_rate_limits r
    where r.bucket = p_bucket and r.window_start = v_start;
    v_hits := coalesce(v_hits, 0);
    return query select v_hits < p_limit, v_hits, v_start + make_interval(secs => p_window_seconds);
  else
    insert into public.admin_rate_limits as r (bucket, window_start, hits, expires_at)
    values (p_bucket, v_start, p_cost, v_start + make_interval(secs => p_window_seconds))
    on conflict (bucket, window_start) do update set hits = r.hits + excluded.hits
    returning r.hits into v_hits;
    return query select v_hits <= p_limit, v_hits, v_start + make_interval(secs => p_window_seconds);
  end if;
end;
$$;

revoke execute on function public.admin_rate_limit_hit(text, integer, integer, integer)
  from public, anon, authenticated, service_role, ff_public_reader;
grant execute on function public.admin_rate_limit_hit(text, integer, integer, integer) to ff_admin_writer;
