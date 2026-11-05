import { describe, expect, it } from "vitest";

import { diff } from "@/lib/audit/revisions";

import { MAX_JSON_BODY_BYTES, readJsonBody } from "./body";
import { ApiError } from "./errors";
import { idempotencyKey, requestHash, toResponse } from "./idempotency";
import { formatEtag, requireIfMatch } from "./version";

// The small pieces behind admin mutations (PR 2.10). End to end in tests/integration/admin-crud.test.ts.

const post = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("https://ff.test/api/admin/venues", { method: "POST", body, headers });

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("readJsonBody", () => {
  it("returns the raw text and the parsed value", async () => {
    await expect(readJsonBody(post('{"a":1}'))).resolves.toEqual({ text: '{"a":1}', json: { a: 1 } });
    await expect(
      readJsonBody(post("{}", { "content-type": "application/json; charset=utf-8" })),
    ).resolves.toMatchObject({ json: {} });
  });

  it.each([
    ["the wrong content type", post("{}", { "content-type": "text/plain" })],
    ["no content type", post("{}", {})],
    ["invalid JSON", post("{nope")],
    ["a body over the limit", post(JSON.stringify({ x: "y".repeat(MAX_JSON_BODY_BYTES) }))],
  ])("rejects %s with 400", async (_name, request) => {
    expect((await apiError(readJsonBody(request))).status).toBe(400);
  });
});

describe("If-Match", () => {
  const withHeader = (value?: string) =>
    new Request("https://ff.test/", value === undefined ? {} : { headers: { "if-match": value } });

  it("reads the version from a strong ETag", () => {
    expect(formatEtag("1761091201000000")).toBe('"1761091201000000"');
    expect(requireIfMatch(withHeader('"1761091201000000"'))).toBe("1761091201000000");
  });

  it.each([undefined, "", "1761091201000000", 'W/"1761091201000000"', '"abc"', "*"])("rejects %j with 400", (value) => {
    expect(() => requireIfMatch(withHeader(value))).toThrow(ApiError);
  });
});

describe("Idempotency-Key", () => {
  const withKey = (value?: string) =>
    new Request("https://ff.test/", value === undefined ? {} : { headers: { "idempotency-key": value } });

  it("is optional, and accepts 8–128 safe characters", () => {
    expect(idempotencyKey(withKey())).toBeNull();
    expect(idempotencyKey(withKey("import-2026-10-22:venue-14"))).toBe("import-2026-10-22:venue-14");
    expect(idempotencyKey(withKey("5eed0000-0000-4000-8000-000000000001"))).not.toBeNull();
  });

  it.each(["short", "x".repeat(129), "has space in it", "semi;colon-key", ""])("rejects %j with 400", (value) => {
    expect(() => idempotencyKey(withKey(value))).toThrow(ApiError);
  });

  it("hashes method, path, If-Match and body, each changing the hash", () => {
    const base = { method: "PATCH", path: "/api/admin/venues/1", ifMatch: '"1"', body: '{"name":"A"}' };
    const hash = requestHash(base).toString("hex");
    expect(requestHash(base).toString("hex")).toBe(hash);
    for (const change of [
      { method: "POST" },
      { path: "/api/admin/venues/2" },
      { ifMatch: '"2"' },
      { body: '{"name":"B"}' },
    ]) {
      expect(requestHash({ ...base, ...change }).toString("hex")).not.toBe(hash);
    }
  });

  it("marks replayed responses", async () => {
    const replay = toResponse({ status: 201, headers: { etag: '"1"' }, body: { ok: true }, replayed: true });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe('"1"');
    expect(await replay.json()).toEqual({ ok: true });
    const fresh = toResponse({ status: 200, headers: {}, body: {}, replayed: false });
    expect(fresh.headers.get("idempotent-replayed")).toBeNull();
  });
});

describe("diff", () => {
  it("lists only fields that change, treating absent as unchanged and missing previous as null", () => {
    expect(
      diff(
        { name: "A", suburb: "X", postcode: null, length_m: 105 },
        { name: "B", suburb: "X", postcode: undefined, length_m: 105, access: "public" },
      ),
    ).toEqual({ name: { from: "A", to: "B" }, access: { from: null, to: "public" } });
  });

  it("records clearing a value to null", () => {
    expect(diff({ description: "old" }, { description: null })).toEqual({ description: { from: "old", to: null } });
  });
});
