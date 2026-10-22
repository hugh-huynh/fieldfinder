import "server-only";

import { idempotencyKey, requestHash, runIdempotent, toResponse, type MutationResult } from "@/lib/api/idempotency";
import type { Tx } from "@/lib/db/types";

import type { AdminContext } from "./admin-route";

// Runs one admin mutation (PR 2.10): a single transaction holding the Idempotency-Key claim, the
// change and its field_revisions rows, so either all of it lands or none of it does.

export async function runMutation<Params>(
  request: Request,
  context: AdminContext<Params>,
  input: { body: string; ifMatch: string | null },
  mutate: (tx: Tx) => Promise<MutationResult>,
): Promise<Response> {
  const key = idempotencyKey(request);
  const path = new URL(request.url).pathname;
  const result = await context.sql.begin((tx) =>
    runIdempotent(
      tx,
      {
        credentialId: context.admin.credentialId,
        key,
        route: `${request.method} ${path}`,
        hash: requestHash({ method: request.method, path, ifMatch: input.ifMatch, body: input.body }),
      },
      () => mutate(tx),
    ),
  );
  return toResponse(result);
}
