// Operator CLI for admin API credentials (ADR-0003, PR 2.9). Run with `pnpm admin:credential <command>`.
//
//   mint   --label <label> --scopes <a,b> [--days 90] [--ip <cidr,cidr>]   prints the new token ONCE
//   rotate --from <old-label> --label <new-label> [--days 90]              new token, same scopes and
//                                                                          allowlist; old one revoked
//   revoke --label <label>
//   list
//
// Connects with DATABASE_URL_OPERATOR: the project's owner connection (e.g. `postgres`), which only
// the operator holds and which is never set in Vercel. The app's ff_admin_writer role can't mint or
// revoke credentials (migration 0003). Only the token's SHA-256 is stored; the token itself is
// printed to stdout once and can't be recovered. Store it in a secret manager straight away.

import { parseArgs } from "node:util";

import postgres from "postgres";

import { ADMIN_SCOPES, isAdminScope } from "../src/lib/auth/scopes.ts";
import { generateToken, hashToken } from "../src/lib/auth/token.ts";
import { tlsOptions } from "../src/lib/db/tls.ts";

const LABEL = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const MAX_DAYS = 365;

function fail(message: string): never {
  console.error(`admin-credential: ${message}`);
  process.exit(1);
}

function label(value: string | undefined, flag: string): string {
  if (value === undefined || !LABEL.test(value) || value.length > 100) {
    fail(`${flag} must be lowercase letters and digits separated by . _ or - (max 100)`);
  }
  return value;
}

function days(value: string | undefined): number {
  const n = Number(value ?? "90");
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS)
    fail(`--days must be a whole number from 1 to ${String(MAX_DAYS)}`);
  return n;
}

function scopes(value: string | undefined): string[] {
  const list = [...new Set((value ?? "").split(",").filter(Boolean))];
  const unknown = list.filter((s) => !isAdminScope(s));
  if (list.length === 0 || unknown.length > 0) {
    fail(`--scopes must be a comma-separated subset of: ${ADMIN_SCOPES.join(", ")}`);
  }
  return list;
}

function cidrs(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const list = value.split(",").filter(Boolean);
  if (list.length === 0) fail("--ip needs at least one address or CIDR range");
  return list; // Postgres validates each one when it's cast to cidr.
}

function printToken(token: string, name: string, expiresAt: Date): void {
  console.error(`Created credential "${name}", expires ${expiresAt.toISOString()}.`);
  console.error("Token (shown once; store it in your secret manager now):");
  // stdout carries only the token, so it can be piped straight into a secret store.
  process.stdout.write(`${token}\n`);
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    label: { type: "string" },
    from: { type: "string" },
    scopes: { type: "string" },
    days: { type: "string" },
    ip: { type: "string" },
  },
  strict: true,
});

const url = process.env.DATABASE_URL_OPERATOR;
if (url === undefined || !/^postgres(ql)?:\/\//.test(url))
  fail("DATABASE_URL_OPERATOR is missing or not a postgres:// URL");

let tls: ReturnType<typeof tlsOptions> = {};
try {
  tls = tlsOptions(url, "DATABASE_URL_OPERATOR");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const sql = postgres(url, { ...tls, max: 1, prepare: false, onnotice: () => undefined, connect_timeout: 10 });

try {
  switch (command) {
    case "mint": {
      const name = label(values.label, "--label");
      const token = generateToken();
      const [row] = await sql<{ expires_at: Date }[]>`
        insert into public.admin_api_credentials (label, token_hash, scopes, expires_at, ip_allowlist)
        values (${name}, ${hashToken(token)}::bytea, ${scopes(values.scopes)}::text[],
                now() + make_interval(days => ${days(values.days)}), ${cidrs(values.ip)}::cidr[])
        returning expires_at
      `;
      printToken(token, name, new Date(String(row?.expires_at)));
      break;
    }
    case "rotate": {
      const from = label(values.from, "--from");
      const name = label(values.label, "--label");
      const token = generateToken();
      const expiresAt = await sql.begin(async (tx) => {
        const [old] = await tx<{ scopes: string[]; ip_allowlist: string[] | null }[]>`
          select scopes, ip_allowlist from public.admin_api_credentials
          where label = ${from} and revoked_at is null for update
        `;
        if (old === undefined) fail(`no active credential labelled "${from}"`);
        const [row] = await tx<{ expires_at: Date }[]>`
          insert into public.admin_api_credentials (label, token_hash, scopes, expires_at, ip_allowlist)
          values (${name}, ${hashToken(token)}::bytea, ${old.scopes}::text[],
                  now() + make_interval(days => ${days(values.days)}), ${old.ip_allowlist}::cidr[])
          returning expires_at
        `;
        await tx`update public.admin_api_credentials set revoked_at = now() where label = ${from}`;
        return new Date(String(row?.expires_at));
      });
      printToken(token, name, expiresAt);
      console.error(`Revoked "${from}".`);
      break;
    }
    case "revoke": {
      const name = label(values.label, "--label");
      const rows = await sql`
        update public.admin_api_credentials set revoked_at = now()
        where label = ${name} and revoked_at is null returning id
      `;
      if (rows.length === 0) fail(`no active credential labelled "${name}"`);
      console.error(`Revoked "${name}".`);
      break;
    }
    case "list": {
      // Never selects token_hash.
      const rows = await sql`
        select label, array_to_string(scopes, ',') as scopes, expires_at, revoked_at, last_used_at,
               array_to_string(ip_allowlist, ',') as ip_allowlist
        from public.admin_api_credentials order by created_at
      `;
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      break;
    }
    default:
      fail("usage: admin-credential <mint|rotate|revoke|list> [options] (see the header of this file)");
  }
} catch (error) {
  // Postgres errors can echo row values in DETAIL; print the message and code only.
  const { message, code } = error as { message?: string; code?: string };
  fail(`${code ?? "error"}: ${message ?? String(error)}`);
} finally {
  await sql.end({ timeout: 5 });
}
