import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { adminRoute } from "@/app/api/admin/_lib/admin-route";
import type { ApiErrorBody } from "@/lib/api/errors";
import { generateToken, hashToken } from "@/lib/auth/token";
import { adminDb } from "@/lib/db/admin";
import { ADMIN_AUTH_FAILURES, ADMIN_CREDENTIAL_REQUESTS } from "@/lib/rate-limit/rules";

import { LOCAL_ADMIN_URL } from "../setup/integration-env";

// adminRoute against the local database as ff_admin_writer (PR 2.9). Credentials are inserted with
// the operator connection, as scripts/admin-credential.ts does. A test-only handler under a real
// operation name (scope venues:write) stands in for an endpoint.

const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });

const GET = adminRoute("admin.venues.read", (_request, { admin }) =>
  Promise.resolve(Response.json({ label: admin.label })),
);

const call = (headers: Record<string, string> = {}, query = "") =>
  GET(new Request(`https://ff.test/api/admin/test${query}`, { headers }), { params: Promise.resolve({}) });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function mint(
  label: string,
  options: { scopes?: string[]; expired?: boolean; revoked?: boolean; ip?: string[] } = {},
): Promise<string> {
  const token = generateToken();
  const created = options.expired === true ? "now() - interval '2 days'" : "now()";
  const expires = options.expired === true ? "now() - interval '1 day'" : "now() + interval '30 days'";
  await operator.unsafe(
    `insert into public.admin_api_credentials (label, token_hash, scopes, created_at, expires_at, revoked_at, ip_allowlist)
     values ($1, $2, $3, ${created}, ${expires}, ${options.revoked === true ? "now()" : "null"}, $4::cidr[])`,
    [label, hashToken(token), options.scopes ?? ["venues:write"], options.ip ?? null],
  );
  return token;
}

/**
 * The limiter counts in fixed windows aligned to the clock (migration 0005), so a burst that straddles
 * a window boundary is split across two counts. Start bursts with at least `margin` ms of the window left.
 */
async function startOfFreshWindow(windowSeconds: number, margin = 5_000): Promise<void> {
  const windowMs = windowSeconds * 1000;
  const left = windowMs - (Date.now() % windowMs);
  if (left < margin) await new Promise((resolve) => setTimeout(resolve, left + 100));
}

async function errorOf(res: Response): Promise<ApiErrorBody> {
  return (await res.json()) as ApiErrorBody;
}

let valid: string;

beforeAll(async () => {
  await operator`delete from public.admin_api_credentials where label like 'it-%'`;
  valid = await mint("it-valid");
});

beforeEach(async () => {
  // Counters persist between runs; start every test with empty windows.
  await operator`delete from public.admin_rate_limits`;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await operator`delete from public.admin_api_credentials where label like 'it-%'`;
  await operator`delete from public.admin_rate_limits`;
  await operator.end({ timeout: 5 });
  await adminDb().end({ timeout: 5 });
});

describe("adminRoute — authenticated", () => {
  it("runs the handler for a valid credential with the scope, uncached, and records use", async () => {
    await operator`update public.admin_api_credentials set last_used_at = null where label = 'it-valid'`;
    const res = await call(bearer(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ label: "it-valid" });
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [row] = await operator<{ used: boolean }[]>`
      select last_used_at > now() - interval '1 minute' as used from public.admin_api_credentials where label = 'it-valid'
    `;
    expect(row?.used).toBe(true);
  });
});

describe("adminRoute — 401", () => {
  it.each([
    ["no header", {}],
    ["malformed header", { authorization: "Bearer nope" }],
    ["unknown token", { authorization: `Bearer ${generateToken()}` }],
  ])("%s", async (_name, headers) => {
    const res = await call(headers);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await errorOf(res)).toMatchObject({ code: "unauthenticated", message: "Authentication is required." });
  });

  it("expired credential", async () => {
    const res = await call(bearer(await mint("it-expired", { expired: true })));
    expect(res.status).toBe(401);
  });

  it("revoked credential", async () => {
    const res = await call(bearer(await mint("it-revoked", { revoked: true })));
    expect(res.status).toBe(401);
  });

  it("IP allowlist: an unknown client IP never matches; a listed one does on Vercel", async () => {
    const token = await mint("it-allowlist", { ip: ["203.0.113.0/24"] });
    expect((await call(bearer(token))).status).toBe(401);

    vi.stubEnv("VERCEL", "1");
    expect((await call({ ...bearer(token), "x-forwarded-for": "198.51.100.1" })).status).toBe(401);
    expect((await call({ ...bearer(token), "x-forwarded-for": "203.0.113.42" })).status).toBe(200);
  });
});

describe("adminRoute — 403", () => {
  it("valid credential without the required scope", async () => {
    const res = await call(bearer(await mint("it-wrong-scope", { scopes: ["media:write"] })));
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ code: "forbidden" });
  });
});

describe("adminRoute — 429", () => {
  it("blocks a client after too many failed attempts, with Retry-After", async () => {
    await startOfFreshWindow(ADMIN_AUTH_FAILURES.windowSeconds);
    for (let i = 0; i < ADMIN_AUTH_FAILURES.limit; i++) {
      expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
    }
    const res = await call(bearer(valid));
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(ADMIN_AUTH_FAILURES.windowSeconds);
    expect(await errorOf(res)).toMatchObject({ code: "rate_limited" });
  });

  it("limits requests per credential", async () => {
    const token = await mint("it-busy");
    await startOfFreshWindow(ADMIN_CREDENTIAL_REQUESTS.windowSeconds);
    for (let i = 0; i < ADMIN_CREDENTIAL_REQUESTS.limit; i++) {
      expect((await call(bearer(token))).status).toBe(200);
    }
    const res = await call(bearer(token));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // Other credentials are unaffected.
    expect((await call(bearer(valid))).status).toBe(200);
  });

  it("stores no raw IP address in the counters", async () => {
    vi.stubEnv("VERCEL", "1");
    await call({ authorization: "Bearer nope", "x-forwarded-for": "203.0.113.99" });
    const rows = await operator<{ bucket: string }[]>`select bucket from public.admin_rate_limits`;
    expect(rows.length).toBeGreaterThan(0);
    for (const { bucket } of rows) expect(bucket).not.toContain("203.0.113.99");
  });
});

describe("adminRoute — credential in the URL", () => {
  it("→ 400, and the token never reaches the logs", async () => {
    const lines: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
    }

    const res = await call({}, `?token=${valid}`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain(valid);
    expect(lines.length).toBeGreaterThan(0); // the request was logged…
    for (const line of lines) expect(line).not.toContain(valid); // …without the token
  });
});
