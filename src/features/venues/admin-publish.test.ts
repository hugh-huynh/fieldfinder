import { describe, expect, it } from "vitest";

import { readJsonBody } from "@/lib/api/body";
import { ApiError } from "@/lib/api/errors";

import { transitionSchema, venuePublishSchema } from "./admin-publish";
import { verificationCreateSchema } from "./admin-verification";

// Request shapes for publishing (PR 2.11). Behaviour against the database is in
// tests/integration/admin-publish.test.ts.

const A = "5eed0000-0000-4000-8001-000000000001";
const B = "5eed0000-0000-4000-8001-000000000002";
const sel = (id: string, version = "1761091201000000") => ({ id, version });

describe("venuePublishSchema", () => {
  it("needs at least one distinct pitch id, with an optional reason", () => {
    expect(venuePublishSchema.safeParse({ pitches: [sel(A)] }).success).toBe(true);
    expect(venuePublishSchema.safeParse({ pitches: [sel(A), sel(B)], reason: " Site visit " }).data?.reason).toBe(
      "Site visit",
    );
  });

  it.each([
    ["a pitch without its version", { pitches: [{ id: A }] }],
    ["a malformed version", { pitches: [sel(A, '"1761091201000000"')] }],
    ["a pitch with extra fields", { pitches: [{ ...sel(A), status: "published" }] }],
    ["no pitches", { pitches: [] }],
    ["no pitches field at all", {}],
    ["a repeated pitch", { pitches: [sel(A), sel(A)] }],
    ["a non-uuid", { pitches: [sel("pitch-1")] }],
    [
      "more than 50 pitches",
      { pitches: Array.from({ length: 51 }, (_, i) => sel(`5eed0000-0000-4000-8001-${String(i).padStart(12, "0")}`)) },
    ],
    ["an unknown field", { pitches: [sel(A)], mediaIds: [B] }],
    ["a blank reason", { pitches: [sel(A)], reason: "   " }],
    ["a reason over 500 characters", { pitches: [sel(A)], reason: "x".repeat(501) }],
  ])("rejects %s", (_name, input) => {
    expect(venuePublishSchema.safeParse(input).success).toBe(false);
  });
});

describe("transitionSchema", () => {
  it("accepts an empty body or a reason, nothing else", () => {
    expect(transitionSchema.safeParse({}).success).toBe(true);
    expect(transitionSchema.safeParse({ reason: "Closed for redevelopment" }).success).toBe(true);
    expect(transitionSchema.safeParse({ status: "published" }).success).toBe(false);
  });
});

describe("verificationCreateSchema", () => {
  const base = { verifiedBy: "Test operator", verifiedOn: "2026-10-30", confidence: "high" };

  it("accepts the required fields and optional evidence, notes and source", () => {
    expect(verificationCreateSchema.safeParse(base).success).toBe(true);
    expect(
      verificationCreateSchema.safeParse({
        ...base,
        evidence: "Photos",
        internalNotes: "Gate code is on file",
        sourceId: A,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["a future date", { ...base, verifiedOn: "2999-01-01" }],
    ["a non-ISO date", { ...base, verifiedOn: "30/10/2026" }],
    ["an impossible date", { ...base, verifiedOn: "2026-02-30" }],
    ["an unknown confidence", { ...base, confidence: "certain" }],
    ["a blank verifier", { ...base, verifiedBy: "  " }],
    ["an unknown field", { ...base, venueId: A }],
  ])("rejects %s", (_name, input) => {
    expect(verificationCreateSchema.safeParse(input).success).toBe(false);
  });
});

describe("readJsonBody({ optional: true })", () => {
  const post = (body?: string, headers: Record<string, string> = {}) =>
    new Request("https://ff.test/", { method: "POST", headers, ...(body === undefined ? {} : { body }) });

  it("reads an empty body without a content type as {}", async () => {
    await expect(readJsonBody(post(), { optional: true })).resolves.toEqual({ text: "", json: {} });
  });

  it("still parses a JSON body", async () => {
    const read = await readJsonBody(post('{"reason":"x"}', { "content-type": "application/json" }), { optional: true });
    expect(read.json).toEqual({ reason: "x" });
  });

  it("rejects a non-empty body without a JSON content type", async () => {
    await expect(readJsonBody(post("reason=x"), { optional: true })).rejects.toBeInstanceOf(ApiError);
  });

  it("is still required by default", async () => {
    await expect(readJsonBody(post())).rejects.toBeInstanceOf(ApiError);
  });
});
