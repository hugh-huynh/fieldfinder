import "server-only";

import { idempotencyKey, requestHash, runIdempotent, toResponse, type MutationResult } from "@/lib/api/idempotency";
import { withRollback } from "@/lib/db/rollback";
import type { Tx } from "@/lib/db/types";

import type { AdminContext } from "./admin-route";

// Runs one admin mutation (PR 2.10): a single transaction holding the Idempotency-Key claim, the
// change and its field_revisions rows, so either all of it lands or none of it does. Storage side
// effects register undos with onRollback (src/lib/db/rollback.ts); they run if anything here fails,
// including saving the idempotency response or the COMMIT itself.

export async function runMutation<Params>(
  request: Request,
  context: AdminContext<Params>,
  input: { body: string; ifMatch: string | null },
  mutate: (tx: Tx) => Promise<MutationResult>,
): Promise<Response> {
  const key = idempotencyKey(request);
  const path = new URL(request.url).pathname;
  const result = await withRollback(context.sql, (tx) =>
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
