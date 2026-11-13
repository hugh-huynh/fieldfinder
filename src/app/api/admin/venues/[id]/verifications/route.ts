import { z } from "zod";

import { createVenueVerification, verificationCreateSchema } from "@/features/venues/admin-verification";
import { readJsonBody } from "@/lib/api/body";
import { parseInput } from "@/lib/api/handler";

import { adminRoute } from "../../../_lib/admin-route";
import { runMutation } from "../../../_lib/mutation";

// POST /api/admin/venues/[id]/verifications — record who verified a venue, when and how sure
// (PR 2.11). A venue needs at least one before it can be published. Scope venues:write. Optional
// Idempotency-Key. All of it is internal and never appears on a public route.

const paramsSchema = z.object({ id: z.uuid() });

export const POST = adminRoute<{ id: string }>("admin.venues.verify", async (request, context) => {
  const { id } = parseInput(paramsSchema, await context.params);
  const { text, json } = await readJsonBody(request);
  const input = parseInput(verificationCreateSchema, json);
  return runMutation(request, context, { body: text, ifMatch: null }, async (tx) => {
    const verification = await createVenueVerification(tx, id, input, context);
    return { status: 201, headers: {}, body: { verification } };
  });
});
