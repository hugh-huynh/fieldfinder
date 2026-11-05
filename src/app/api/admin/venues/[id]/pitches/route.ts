import { z } from "zod";

import { pitchCreateSchema } from "@/features/pitches/admin-schema";
import { createPitch } from "@/features/pitches/admin-service";
import { readJsonBody } from "@/lib/api/body";
import { parseInput } from "@/lib/api/handler";
import { formatEtag } from "@/lib/api/version";

import { adminRoute } from "../../../_lib/admin-route";
import { runMutation } from "../../../_lib/mutation";

// POST /api/admin/venues/[id]/pitches — create a draft pitch at a venue (spec §5, PR 2.10).
// Scope pitches:write. Optional Idempotency-Key. 201 with the pitch, its ETag and Location.

const paramsSchema = z.object({ id: z.uuid() });

export const POST = adminRoute<{ id: string }>("admin.pitches.create", "pitches:write", async (request, context) => {
  const { id: venueId } = parseInput(paramsSchema, await context.params);
  const { text, json } = await readJsonBody(request);
  const input = parseInput(pitchCreateSchema, json);
  return runMutation(request, context, { body: text, ifMatch: null }, async (tx) => {
    const pitch = await createPitch(tx, venueId, input, context);
    return {
      status: 201,
      headers: { etag: formatEtag(pitch.version), location: `/api/admin/pitches/${pitch.id}` },
      body: { pitch },
    };
  });
});
