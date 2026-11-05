import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { LOCAL_ADMIN_URL } from "../setup/integration-env";

// Two transactions reclaiming different expired Idempotency-Keys at the same time (PR 2.10 review).
// Each first deletes its own expired row, then purges other expired rows. Without SKIP LOCKED in the
// purge, A waits on B's row while B waits on A's, and Postgres aborts one with a deadlock (40P01).
// pgTAP runs on one connection, so this needs two real ones.

const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });
const run = randomUUID().slice(0, 8);
const credentialId = randomUUID();
const keyA = `idem-${run}-a`;
const keyB = `idem-${run}-b`;
const hash = (text: string) => operator`select sha256(${text}::bytea) as h`.then(([row]) => (row as { h: Buffer }).h);

function connection(name: string) {
  return postgres(LOCAL_ADMIN_URL, {
    max: 1,
    onnotice: () => undefined,
    connection: { application_name: `${name}-${run}` },
  });
}

async function claim(sql: postgres.Sql, key: string, request: string): Promise<string> {
  const [row] = await sql<{ state: string }[]>`
    select state from public.admin_idempotency_begin(
      ${credentialId}::uuid, ${key}, 'POST /api/admin/venues', ${await hash(request)}
    )
  `;
  return String(row?.state);
}

afterAll(async () => {
  await operator`delete from public.admin_idempotency_keys where credential_id = ${credentialId}::uuid`;
  await operator`delete from public.admin_api_credentials where id = ${credentialId}::uuid`;
  await operator.end({ timeout: 5 });
});

describe("admin_idempotency_begin() under concurrency", () => {
  it("doesn't deadlock when two requests reclaim different expired keys at once", async () => {
    await operator`
      insert into public.admin_api_credentials (id, label, token_hash, scopes, expires_at)
      values (${credentialId}::uuid, ${`idem-${run}`}, ${await hash(`token-${run}`)}, ${["venues:write"]},
              now() + interval '1 day')
    `;
    for (const key of [keyA, keyB]) {
      await operator`
        insert into public.admin_idempotency_keys
          (credential_id, idempotency_key, route, request_hash, response_status, response_headers, response_body,
           created_at, expires_at)
        values (${credentialId}::uuid, ${key}, 'POST /api/admin/venues', ${await hash(`old-${key}`)}, 201, '{}', '{}',
                now() - interval '2 days', now() - interval '1 day')
      `;
    }

    const a = connection("idem-a");
    const b = connection("idem-b");
    try {
      // B has done the first step of its own claim: it holds its expired row.
      await b`begin`;
      await b`delete from public.admin_idempotency_keys where credential_id = ${credentialId}::uuid
               and idempotency_key = ${keyB} and expires_at <= now()`;

      // A claims its key; its purge reaches B's row.
      const claimA = (async () => {
        await a`begin`;
        const state = await claim(a, keyA, `new-${keyA}`);
        await a`commit`;
        return state;
      })();
      // Awaited below; this only stops a failure here being reported as unhandled while B runs.
      claimA.catch(() => undefined);

      // Give A time to reach B's row (it blocks there without SKIP LOCKED, and goes straight through with it).
      await new Promise((resolve) => setTimeout(resolve, 300));

      // B's purge now reaches A's row. Without SKIP LOCKED, this is the deadlock.
      const stateB = await claim(b, keyB, `new-${keyB}`);
      await b`commit`;

      expect(await claimA).toBe("new");
      expect(stateB).toBe("new");
    } finally {
      await Promise.allSettled([a.end({ timeout: 5 }), b.end({ timeout: 5 })]);
    }

    const rows = await operator<{ idempotency_key: string; fresh: boolean }[]>`
      select idempotency_key, expires_at > now() as fresh from public.admin_idempotency_keys
      where credential_id = ${credentialId}::uuid order by idempotency_key
    `;
    expect(rows).toEqual([
      { idempotency_key: keyA, fresh: true },
      { idempotency_key: keyB, fresh: true },
    ]);
  });
});
