import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { JsonValue, Tx } from "@/lib/db/types";

import { ApiError } from "./errors";

// Idempotency-Key for admin mutations (spec §5, PR 2.10, migration 0006). Optional: without the
// header a request just runs. With it, the first successful response is stored for 24 hours and a
// retry with the same key and the same request gets that response back, marked
// `Idempotent-Replayed: true`, without running the mutation again. The same key with a different
// request → 422. Errors aren't stored, so a failed request can be retried with the same key.

export const IDEMPOTENCY_HEADER = "idempotency-key";
const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

export interface MutationResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** The Idempotency-Key header, or null when absent. A malformed key → 400. */
export function idempotencyKey(request: Request): string | null {
  const value = request.headers.get(IDEMPOTENCY_HEADER);
  if (value === null) return null;
  if (!KEY.test(value)) {
    throw new ApiError("invalid_request", "Idempotency-Key must be 8–128 characters: letters, digits, _ . : -");
  }
  return value;
}

/** SHA-256 over everything that makes two requests "the same": method, path, If-Match and body. */
export function requestHash(parts: { method: string; path: string; ifMatch: string | null; body: string }): Buffer {
  return createHash("sha256")
    .update(JSON.stringify([parts.method, parts.path, parts.ifMatch, parts.body]), "utf8")
    .digest();
}

const beginRow = z.object({
  state: z.enum(["new", "replay", "mismatch"]),
  response_status: z.number().int().nullable(),
  response_headers: z.record(z.string(), z.string()).nullable(),
  response_body: z.unknown(),
});

/** Runs `mutate` at most once per key. Call inside the transaction that does the mutation. */
export async function runIdempotent(
  tx: Tx,
  claim: { credentialId: string; key: string | null; route: string; hash: Buffer },
  mutate: () => Promise<MutationResult>,
): Promise<MutationResult & { replayed: boolean }> {
  if (claim.key === null) return { ...(await mutate()), replayed: false };

  const [row] = await tx`
    select * from public.admin_idempotency_begin(
      ${claim.credentialId}::uuid, ${claim.key}::text, ${claim.route}::text, ${claim.hash}::bytea
    )
  `;
  const begun = beginRow.parse(row);
  if (begun.state === "mismatch") throw new ApiError("idempotency_mismatch");
  if (begun.state === "replay") {
    return {
      status: begun.response_status ?? 200,
      headers: begun.response_headers ?? {},
      body: begun.response_body,
      replayed: true,
    };
  }

  const result = await mutate();
  await tx`
    select public.admin_idempotency_finish(
      ${claim.credentialId}::uuid, ${claim.key}::text, ${result.status}::smallint,
      ${tx.json(result.headers)}::jsonb, ${tx.json(result.body as JsonValue)}::jsonb
    )
  `;
  return { ...result, replayed: false };
}

export function toResponse(result: MutationResult & { replayed: boolean }): Response {
  const headers = new Headers(result.headers);
  if (result.replayed) headers.set("idempotent-replayed", "true");
  return Response.json(result.body, { status: result.status, headers });
}
