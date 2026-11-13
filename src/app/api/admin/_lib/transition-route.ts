import "server-only";

import { z } from "zod";

import type { Actor } from "@/features/venues/admin-service";
import { readJsonBody } from "@/lib/api/body";
import { parseInput } from "@/lib/api/handler";
import type { AdminOperationWithScope } from "@/lib/api/operations";
import { formatEtag, requireIfMatch } from "@/lib/api/version";
import type { Tx } from "@/lib/db/types";

import { adminRoute } from "./admin-route";
import { runMutation } from "./mutation";

// Builds a POST status-transition route (PR 2.11): publish, unpublish or archive. Scope
// content:publish; If-Match required; optional Idempotency-Key. 200 with the result and the ETag of
// the record the URL names.

const paramsSchema = z.object({ id: z.uuid() });

export function transitionRoute<Input, Result>(options: {
  name: AdminOperationWithScope<"content:publish">;
  schema: z.ZodType<Input>;
  /** True when the body may be empty (it only carries an optional reason). */
  optionalBody: boolean;
  run: (tx: Tx, id: string, ifMatch: string, input: Input, actor: Actor) => Promise<Result>;
  version: (result: Result) => string;
}) {
  return adminRoute<{ id: string }>(options.name, async (request, context) => {
    const { id } = parseInput(paramsSchema, await context.params);
    const ifMatch = requireIfMatch(request);
    const { text, json } = await readJsonBody(request, { optional: options.optionalBody });
    const input = parseInput(options.schema, json);
    return runMutation(request, context, { body: text, ifMatch }, async (tx) => {
      const result = await options.run(tx, id, ifMatch, input, context);
      return { status: 200, headers: { etag: formatEtag(options.version(result)) }, body: result };
    });
  });
}
