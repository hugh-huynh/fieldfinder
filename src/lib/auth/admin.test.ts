import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { createLogger } from "@/lib/log";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { ADMIN_AUTH_FAILURES, ADMIN_CREDENTIAL_REQUESTS } from "@/lib/rate-limit/rules";

import { authenticateAdmin, type AdminAuthDeps } from "./admin";
import type { CredentialRecord, CredentialStore } from "./credential-store";
import { generateToken, hashToken } from "./token";

// The checks in order, with an in-memory store and limiter. Against the real database (and through
// adminRoute) in tests/integration/admin-auth.test.ts.

const NOW = new Date("2026-10-20T10:00:30Z");
const TOKEN = generateToken();

function record(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: "5eed0000-0000-4000-9000-000000000001",
    label: "import-script",
    scopes: ["venues:write"],
    tokenHash: hashToken(TOKEN),
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    revokedAt: null,
    ipAllowed: true,
    ...overrides,
  };
}

function setup(stored: CredentialRecord | null = record()) {
  const touched: string[] = [];
  const store: CredentialStore = {
    findByTokenHash: (hash) => Promise.resolve(stored !== null && stored.tokenHash.equals(hash) ? stored : null),
    touch: (id) => {
      touched.push(id);
      return Promise.resolve();
    },
  };
  const limiter = createMemoryRateLimiter(() => NOW);
  const deps: AdminAuthDeps = { store, limiter, clientIp: "203.0.113.7", now: () => NOW };
  return { deps, limiter, touched };
}

function req(authorization?: string, url = "https://ff.test/api/admin/venues"): Request {
  return new Request(url, authorization === undefined ? {} : { headers: { authorization } });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("authenticateAdmin — success", () => {
  it("returns the principal for a valid token with the scope, and records use", async () => {
    const { deps, touched } = setup();
    const principal = await authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", deps);
    expect(principal).toEqual({
      credentialId: record().id,
      label: "import-script",
      scopes: ["venues:write"],
    });
    expect(touched).toEqual([record().id]);
  });

  it("accepts the scheme name in any case", async () => {
    const { deps } = setup();
    await expect(authenticateAdmin(req(`bearer ${TOKEN}`), "venues:write", deps)).resolves.toBeDefined();
  });
});

describe("authenticateAdmin — 401", () => {
  it.each([
    ["no header", undefined],
    ["empty header", ""],
    ["another scheme", `Basic ${TOKEN}`],
    ["extra whitespace", `Bearer  ${TOKEN}`],
    ["trailing data", `Bearer ${TOKEN} extra`],
    ["malformed token", "Bearer not-a-token"],
    ["wrong prefix", `Bearer ${TOKEN.replace("ffadm_", "ffxxx_")}`],
    ["unknown token", `Bearer ${generateToken()}`],
  ])("%s", async (_name, authorization) => {
    const { deps, touched } = setup();
    const error = await rejection(authenticateAdmin(req(authorization), "venues:write", deps));
    expect(error).toMatchObject({ code: "unauthenticated", status: 401, headers: { "www-authenticate": "Bearer" } });
    expect(touched).toEqual([]);
  });

  it.each([
    ["expired", record({ expiresAt: new Date("2026-10-20T10:00:00Z") })],
    ["revoked", record({ revokedAt: new Date("2026-10-19T00:00:00Z") })],
    ["client IP outside the allowlist", record({ ipAllowed: false })],
  ])("%s, with the same message as any other failure", async (_name, stored) => {
    const { deps } = setup(stored);
    const error = await rejection(authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", deps));
    expect(error).toMatchObject({ code: "unauthenticated", publicMessage: "Authentication is required." });
  });
});

describe("authenticateAdmin — 403", () => {
  it("rejects a valid credential without the required scope", async () => {
    const { deps, touched } = setup();
    const error = await rejection(authenticateAdmin(req(`Bearer ${TOKEN}`), "content:publish", deps));
    expect(error).toMatchObject({ code: "forbidden", status: 403 });
    expect(touched).toEqual([]);
  });
});

describe("authenticateAdmin — 400 for a credential in the URL", () => {
  it.each([
    ["token parameter", "?token=abc"],
    ["access_token parameter", "?access_token=abc"],
    ["api key parameter, any case", "?API_KEY=abc"],
    ["a token under another name", `?q=${TOKEN}`],
  ])("%s", async (_name, query) => {
    const { deps, limiter } = setup();
    const error = await rejection(
      authenticateAdmin(req(`Bearer ${TOKEN}`, `https://ff.test/api/admin/venues${query}`), "venues:write", deps),
    );
    expect(error).toMatchObject({ code: "invalid_request", status: 400 });
    // The message never repeats the URL or the token.
    expect(error.publicMessage).not.toContain("abc");
    expect(error.publicMessage).not.toContain(TOKEN);
    // Rejected before any counting.
    expect((await limiter.hit(ADMIN_AUTH_FAILURES, "203.0.113.7", 0)).hits).toBe(0);
  });

  it("logs a distinct event so the operator can rotate, without the URL or the token", async () => {
    const lines: string[] = [];
    const { deps } = setup();
    const logger = createLogger((_level, line) => lines.push(line), "debug");
    await rejection(
      authenticateAdmin(req(undefined, `https://ff.test/api/admin/venues?token=${TOKEN}`), "venues:write", {
        ...deps,
        logger,
      }),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ level: "warn", event: "admin.credential_in_url" });
    expect(lines[0]).not.toContain(TOKEN);
    expect(lines[0]).not.toContain("token=");
  });
});

describe("authenticateAdmin — 429", () => {
  it("blocks a client after too many failures, even with a valid token, with Retry-After", async () => {
    const { deps } = setup();
    for (let i = 0; i < ADMIN_AUTH_FAILURES.limit; i++) {
      await rejection(authenticateAdmin(req("Bearer wrong"), "venues:write", deps));
    }
    const error = await rejection(authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", deps));
    expect(error).toMatchObject({ code: "rate_limited", status: 429, headers: { "retry-after": "30" } });
  });

  it("counts failures per client: another IP isn't blocked", async () => {
    const { deps } = setup();
    for (let i = 0; i < ADMIN_AUTH_FAILURES.limit; i++) {
      await rejection(authenticateAdmin(req("Bearer wrong"), "venues:write", deps));
    }
    const other = { ...deps, clientIp: "198.51.100.9" };
    await expect(authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", other)).resolves.toBeDefined();
  });

  it("limits requests per credential, whatever IP they come from", async () => {
    const { deps } = setup();
    for (let i = 0; i < ADMIN_CREDENTIAL_REQUESTS.limit; i++) {
      const ip = `198.51.100.${String(i % 200)}`;
      await authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", { ...deps, clientIp: ip });
    }
    const error = await rejection(authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", deps));
    expect(error).toMatchObject({ code: "rate_limited", headers: { "retry-after": "30" } });
  });

  it("counts IPv6 failures per /64, so rotating addresses inside it doesn't help", async () => {
    const { deps } = setup();
    for (let i = 0; i < ADMIN_AUTH_FAILURES.limit; i++) {
      const ip = `2001:db8:1:2::${(i + 1).toString(16)}`;
      await rejection(authenticateAdmin(req("Bearer wrong"), "venues:write", { ...deps, clientIp: ip }));
    }
    const sameBlock = { ...deps, clientIp: "2001:db8:1:2::beef" };
    expect((await rejection(authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", sameBlock))).code).toBe(
      "rate_limited",
    );
    const otherBlock = { ...deps, clientIp: "2001:db8:1:3::1" };
    await expect(authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", otherBlock)).resolves.toBeDefined();
  });

  it("treats every unknown client IP as one client", async () => {
    const { deps } = setup();
    const unknown = { ...deps, clientIp: null };
    for (let i = 0; i < ADMIN_AUTH_FAILURES.limit; i++) {
      await rejection(authenticateAdmin(req("Bearer wrong"), "venues:write", unknown));
    }
    const error = await rejection(authenticateAdmin(req(`Bearer ${TOKEN}`), "venues:write", unknown));
    expect(error.code).toBe("rate_limited");
  });
});
