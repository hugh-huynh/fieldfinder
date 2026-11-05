-- 0006_admin_idempotency: Idempotency-Key support for admin mutations (M2 PR 2.10, approved by Hugh).
-- Spec §5: "design idempotency for retryable mutations". Forward-only: never edit after merge.
--
-- A key belongs to one credential. Both functions run inside the same transaction as the mutation:
--   1. admin_idempotency_begin() claims the key ('new'), or reports a stored response ('replay') or
--      a different request under the same key ('mismatch'). A concurrent request with the same key
--      blocks on the primary key until the first transaction ends, then sees its outcome.
--   2. After a successful mutation, admin_idempotency_finish() stores the response.
-- If the mutation fails, the transaction rolls back and the claim disappears, so a retry runs again.
-- Rows expire after 24 hours. ff_admin_writer gets EXECUTE on the two functions only.

create table public.admin_idempotency_keys (
  credential_id uuid not null references public.admin_api_credentials (id) on delete restrict,
  idempotency_key text not null,
  -- "<METHOD> <path>", so a key reused on another endpoint is a mismatch.
  route text not null,
  -- SHA-256 of the request (method, path, body), computed by the app.
  request_hash bytea not null,
  response_status smallint,
  response_headers jsonb,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',

  constraint admin_idempotency_keys_pkey primary key (credential_id, idempotency_key),
  constraint admin_idempotency_keys_key_format check (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  constraint admin_idempotency_keys_route_length check (char_length(route) between 1 and 300),
  constraint admin_idempotency_keys_hash_sha256 check (octet_length(request_hash) = 32),
  constraint admin_idempotency_keys_status_range check (response_status is null or response_status between 200 and 299),
  constraint admin_idempotency_keys_response_complete check (
    (response_status is null) = (response_body is null) and (response_status is null) = (response_headers is null)
  ),
  constraint admin_idempotency_keys_expiry check (expires_at > created_at)
);

create index admin_idempotency_keys_expires_at_idx on public.admin_idempotency_keys (expires_at);

alter table public.admin_idempotency_keys enable row level security;
revoke all on public.admin_idempotency_keys from public, anon, authenticated, service_role, ff_public_reader, ff_admin_writer;

-- ---------------------------------------------------------------------------
-- admin_idempotency_begin(): claim a key, or report what it already holds.
-- Returns state 'new' | 'replay' | 'mismatch', plus the stored response for 'replay'.
-- ---------------------------------------------------------------------------

create function public.admin_idempotency_begin(
  p_credential_id uuid,
  p_key text,
  p_route text,
  p_request_hash bytea
)
returns table (state text, response_status smallint, response_headers jsonb, response_body jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row public.admin_idempotency_keys%rowtype;
begin
  if p_credential_id is null or p_key is null or p_key !~ '^[A-Za-z0-9_.:-]{8,128}$' then
    raise exception 'invalid p_key' using errcode = '22023';
  end if;
  if p_route is null or char_length(p_route) not between 1 and 300 then
    raise exception 'invalid p_route' using errcode = '22023';
  end if;
  if p_request_hash is null or octet_length(p_request_hash) <> 32 then
    raise exception 'invalid p_request_hash' using errcode = '22023';
  end if;

  -- An expired claim on this key no longer counts; also purge a bounded batch of other expired rows.
  -- SKIP LOCKED: the purge never waits on a row another transaction holds (e.g. one reclaiming its own
  -- expired key), so two concurrent purges can't deadlock; skipped rows go in a later purge.
  delete from public.admin_idempotency_keys k
  where k.credential_id = p_credential_id and k.idempotency_key = p_key and k.expires_at <= now();
  delete from public.admin_idempotency_keys
  where ctid in (
    select ctid from public.admin_idempotency_keys where expires_at <= now() limit 100 for update skip locked
  );

  insert into public.admin_idempotency_keys (credential_id, idempotency_key, route, request_hash)
  values (p_credential_id, p_key, p_route, p_request_hash)
  on conflict (credential_id, idempotency_key) do nothing;
  if found then
    return query select 'new'::text, null::smallint, null::jsonb, null::jsonb;
    return;
  end if;

  select * into v_row
  from public.admin_idempotency_keys k
  where k.credential_id = p_credential_id and k.idempotency_key = p_key;

  if v_row.route <> p_route or v_row.request_hash <> p_request_hash or v_row.response_status is null then
    -- A committed row always has a response, so a NULL one can only mean misuse; treat it as a mismatch.
    return query select 'mismatch'::text, null::smallint, null::jsonb, null::jsonb;
  else
    return query select 'replay'::text, v_row.response_status, v_row.response_headers, v_row.response_body;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_idempotency_finish(): store the successful response for a key claimed in this transaction.
-- ---------------------------------------------------------------------------

create function public.admin_idempotency_finish(
  p_credential_id uuid,
  p_key text,
  p_status smallint,
  p_headers jsonb,
  p_body jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not between 200 and 299 then
    raise exception 'invalid p_status' using errcode = '22023';
  end if;
  if p_headers is null or jsonb_typeof(p_headers) <> 'object' or p_body is null then
    raise exception 'invalid p_headers or p_body' using errcode = '22023';
  end if;

  update public.admin_idempotency_keys k
  set response_status = p_status, response_headers = p_headers, response_body = p_body
  where k.credential_id = p_credential_id and k.idempotency_key = p_key and k.response_status is null;
  if not found then
    raise exception 'no open idempotency claim for this key' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.admin_idempotency_begin(uuid, text, text, bytea)
  from public, anon, authenticated, service_role, ff_public_reader;
revoke execute on function public.admin_idempotency_finish(uuid, text, smallint, jsonb, jsonb)
  from public, anon, authenticated, service_role, ff_public_reader;
grant execute on function public.admin_idempotency_begin(uuid, text, text, bytea) to ff_admin_writer;
grant execute on function public.admin_idempotency_finish(uuid, text, smallint, jsonb, jsonb) to ff_admin_writer;
