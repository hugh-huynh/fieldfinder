import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashToken, isWellFormedToken } from "@/lib/auth/token";

import { LOCAL_ADMIN_URL } from "../setup/integration-env";

// scripts/admin-credential.ts end to end against the local database (PR 2.9).

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../scripts/admin-credential.ts", import.meta.url));
const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });

async function cli(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DATABASE_URL_OPERATOR: LOCAL_ADMIN_URL },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout, stderr: e.stderr, code: e.code };
  }
}

type Row = { label: string; scopes: string[]; revoked: boolean; days: number; token_hash: Buffer };

async function row(label: string): Promise<Row | undefined> {
  const [r] = await operator<Row[]>`
    select label, scopes, revoked_at is not null as revoked, token_hash,
           round(extract(epoch from expires_at - created_at) / 86400)::int as days
    from public.admin_api_credentials where label = ${label}
  `;
  return r;
}

beforeAll(async () => {
  await operator`delete from public.admin_api_credentials where label like 'cli-%'`;
});

afterAll(async () => {
  await operator`delete from public.admin_api_credentials where label like 'cli-%'`;
  await operator.end({ timeout: 5 });
});

describe("admin-credential CLI", () => {
  it("mint prints only the token on stdout and stores only its hash", async () => {
    const out = await cli("mint", "--label", "cli-one", "--scopes", "venues:write,pitches:write", "--days", "30");
    expect(out.code).toBe(0);
    const token = out.stdout.trim();
    expect(isWellFormedToken(token)).toBe(true);
    expect(out.stderr).not.toContain(token);

    const stored = await row("cli-one");
    expect(stored).toMatchObject({ scopes: ["venues:write", "pitches:write"], revoked: false, days: 30 });
    expect(stored?.token_hash.equals(hashToken(token))).toBe(true);
  });

  it("list never shows tokens or hashes", async () => {
    const out = await cli("list");
    expect(out.code).toBe(0);
    const listed = JSON.parse(out.stdout) as Record<string, unknown>[];
    const one = listed.find((r) => r.label === "cli-one");
    expect(one).toBeDefined();
    expect(Object.keys(one ?? {}).sort()).toEqual([
      "expires_at",
      "ip_allowlist",
      "label",
      "last_used_at",
      "revoked_at",
      "scopes",
    ]);
  });

  it("rotate mints a new token with the same scopes and revokes the old one", async () => {
    const out = await cli("rotate", "--from", "cli-one", "--label", "cli-two");
    expect(out.code).toBe(0);
    expect(isWellFormedToken(out.stdout.trim())).toBe(true);
    expect(await row("cli-one")).toMatchObject({ revoked: true });
    expect(await row("cli-two")).toMatchObject({ scopes: ["venues:write", "pitches:write"], revoked: false });
  });

  it("revoke revokes, and refuses a second time", async () => {
    expect((await cli("revoke", "--label", "cli-two")).code).toBe(0);
    expect(await row("cli-two")).toMatchObject({ revoked: true });
    const again = await cli("revoke", "--label", "cli-two");
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("no active credential");
  });

  it.each([
    ["an unknown scope", ["mint", "--label", "cli-bad", "--scopes", "admin"]],
    ["no scopes", ["mint", "--label", "cli-bad", "--scopes", ""]],
    ["a lifetime over a year", ["mint", "--label", "cli-bad", "--scopes", "venues:write", "--days", "366"]],
    ["an invalid label", ["mint", "--label", "Bad Label", "--scopes", "venues:write"]],
    ["an invalid IP range", ["mint", "--label", "cli-bad", "--scopes", "venues:write", "--ip", "not-a-cidr"]],
    ["an unknown command", ["delete"]],
  ])("rejects %s without printing a token", async (_name, args) => {
    const out = await cli(...args);
    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(await row("cli-bad")).toBeUndefined();
  });

  it("refuses a remote database URL that turns TLS off, before connecting and without echoing it", async () => {
    const url = "postgresql://postgres.ref:secret-pw@db.example.invalid:6543/postgres?sslmode=disable";
    try {
      await run(process.execPath, [SCRIPT, "list"], {
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DATABASE_URL_OPERATOR: url },
      });
      expect.unreachable();
    } catch (error) {
      const { stderr } = error as { stderr: string };
      expect(stderr).toContain("DATABASE_URL_OPERATOR must use TLS for a remote database");
      expect(stderr).not.toContain("secret-pw");
    }
  });

  it("refuses to run without DATABASE_URL_OPERATOR", async () => {
    try {
      await run(process.execPath, [SCRIPT, "list"], {
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
      });
      expect.unreachable();
    } catch (error) {
      expect((error as { stderr: string }).stderr).toContain("DATABASE_URL_OPERATOR is missing");
    }
  });
});
