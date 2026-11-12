import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ApiErrorBody } from "@/lib/api/errors";
import { ADMIN_SCOPES, type AdminScope } from "@/lib/auth/scopes";
import { generateToken, hashToken } from "@/lib/auth/token";
import { adminDb } from "@/lib/db/admin";

import { LOCAL_ADMIN_URL } from "../../setup/integration-env";

// Admin 401/403 matrix (PR 2.15, ADR-0003). Every admin operation in docs/api/openapi.json (which a
// unit test keeps equal to the route files) is called with each kind of bad credential, then with a
// token that has every scope but the one it needs, then with exactly that scope. The route list and
// scopes come from the contract, so a new admin route is covered without editing this file.

const ROOT = join(import.meta.dirname, "..", "..", "..");
const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });

interface Operation {
  method: "GET" | "POST" | "PATCH";
  path: string;
  scope: AdminScope;
}

const openapi = JSON.parse(readFileSync(join(ROOT, "docs/api/openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, { description?: string; security?: unknown }>>;
};

const operations: Operation[] = Object.entries(openapi.paths)
  .filter(([path]) => path.startsWith("/api/admin/"))
  .flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => {
      const scope = /Scope: `([a-z:]+)`/.exec(op.description ?? "")?.[1];
      if (scope === undefined || !(ADMIN_SCOPES as readonly string[]).includes(scope)) {
        throw new Error(`${method} ${path}: no valid "Scope:" in its OpenAPI description`);
      }
      return { method: method.toUpperCase() as Operation["method"], path, scope: scope as AdminScope };
    }),
  );

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ID = "5eed0000-0000-4000-8000-0000ffffffff"; // well-formed, matches nothing

async function handlerFor(op: Operation): Promise<Handler> {
  const file = join(ROOT, "src/app", op.path.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");
  const exports = (await import(/* @vite-ignore */ file)) as Record<string, Handler | undefined>;
  const handler = exports[op.method];
  if (handler === undefined) throw new Error(`${file} doesn't export ${op.method}`);
  return handler;
}

async function call(op: Operation, headers: Record<string, string>, query = ""): Promise<Response> {
  // The failed-login limiter would start answering 429 partway through the matrix; each call here
  // tests authentication on its own, so every call starts with empty counters.
  await operator`delete from public.admin_rate_limits`;
  const url = `https://ff.test${op.path.replace(/\{\w+\}/g, ID)}${query}`;
  const handler = await handlerFor(op);
  return handler(new Request(url, { method: op.method, headers }), {
    params: Promise.resolve(Object.fromEntries([...op.path.matchAll(/\{(\w+)\}/g)].map((m) => [m[1] ?? "", ID]))),
  });
}

async function mint(label: string, scopes: readonly string[], state: "valid" | "expired" | "revoked" = "valid") {
  const token = generateToken();
  await operator.unsafe(
    `insert into public.admin_api_credentials (label, token_hash, scopes, created_at, expires_at, revoked_at)
     values ($1, $2, $3, now() - interval '2 days',
             ${state === "expired" ? "now() - interval '1 day'" : "now() + interval '1 day'"},
             ${state === "revoked" ? "now()" : "null"})`,
    [label, hashToken(token), scopes],
  );
  return token;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tokens: Partial<Record<string, string>> = {};
const token = (name: string) => tokens[name] ?? "";

beforeAll(async () => {
  await operator`delete from public.admin_api_credentials where label like 'sweep-%'`;
  tokens.revoked = await mint("sweep-revoked", ADMIN_SCOPES, "revoked");
  tokens.expired = await mint("sweep-expired", ADMIN_SCOPES, "expired");
  for (const scope of ADMIN_SCOPES) {
    tokens[`only:${scope}`] = await mint(`sweep-only-${scope.replace(":", ".")}`, [scope]);
    tokens[`all-but:${scope}`] = await mint(
      `sweep-all-but-${scope.replace(":", ".")}`,
      ADMIN_SCOPES.filter((s) => s !== scope),
    );
  }
});

beforeEach(async () => {
  await operator`delete from public.admin_rate_limits`;
});

afterAll(async () => {
  await operator`delete from public.admin_api_credentials where label like 'sweep-%'`;
  await operator`delete from public.admin_rate_limits`;
  await operator.end({ timeout: 5 });
  await adminDb().end({ timeout: 5 });
});

/** Status and body, with the per-request id removed so bodies can be compared. */
async function outcome(res: Response): Promise<{ status: number; body: Omit<ApiErrorBody, "requestId"> }> {
  const { requestId, ...body } = (await res.json()) as ApiErrorBody;
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  return { status: res.status, body };
}

describe("the contract lists the admin operations", () => {
  it("covers every scope (src/lib/openapi/document.test.ts keeps the contract equal to the route files)", () => {
    expect(operations.length).toBeGreaterThan(0);
    expect(new Set(operations.map((o) => o.scope))).toEqual(new Set(ADMIN_SCOPES));
  });
});

describe.each(operations.map((op) => [`${op.method} ${op.path}`, op] as const))("%s", (_name, op) => {
  it("401s every bad credential with one identical body, so the reason can't be told apart", async () => {
    const unknown = generateToken(); // well-formed, never stored
    const cases: Record<string, Record<string, string>> = {
      "no Authorization header": {},
      "an empty header": { authorization: "" },
      "the Basic scheme": { authorization: `Basic ${Buffer.from("admin:admin").toString("base64")}` },
      "Bearer with no token": { authorization: "Bearer " },
      "a malformed token": bearer("not-a-token"),
      "an unknown token": bearer(unknown),
      "a revoked token": bearer(token("revoked")),
      "an expired token": bearer(token("expired")),
    };
    const results = [];
    for (const [name, headers] of Object.entries(cases)) {
      const res = await call(op, headers);
      expect(res.headers.get("cache-control"), name).toBe("no-store");
      results.push({ name, ...(await outcome(res)) });
    }
    for (const result of results) {
      expect({ status: result.status, body: result.body }, result.name).toEqual({
        status: 401,
        body: results[0]?.body,
      });
    }
    expect(results[0]?.body.code).toBe("unauthenticated");
  });

  it(`403s a valid token that has every scope except ${op.scope}`, async () => {
    const result = await outcome(await call(op, bearer(token(`all-but:${op.scope}`))));
    expect(result).toEqual({ status: 403, body: { code: "forbidden", message: expect.any(String) as string } });
  });

  it(`gets past authentication with only ${op.scope}`, async () => {
    const res = await call(op, bearer(token(`only:${op.scope}`)));
    // No body, If-Match or real id, so it stops at validation or lookup, never at the auth checks.
    expect([401, 403, 429], `status ${String(res.status)}`).not.toContain(res.status);
    expect(res.status).toBeLessThan(500);
  });

  it("refuses a token in the query string with 400, even a valid one", async () => {
    const result = await outcome(await call(op, {}, `?access_token=${token(`only:${op.scope}`)}`));
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("invalid_request");
  });
});
