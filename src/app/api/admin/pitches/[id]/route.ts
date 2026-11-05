import { z } from "zod";

import { pitchPatchSchema } from "@/features/pitches/admin-schema";
import { readAdminPitch, updatePitch } from "@/features/pitches/admin-service";
import { readJsonBody } from "@/lib/api/body";
import { ApiError } from "@/lib/api/errors";
import { parseInput } from "@/lib/api/handler";
import { formatEtag, requireIfMatch } from "@/lib/api/version";

import { adminRoute } from "../../_lib/admin-route";
import { runMutation } from "../../_lib/mutation";

// GET   /api/admin/pitches/[id] — the admin view of a pitch, with its ETag (needed before a PATCH).
// PATCH /api/admin/pitches/[id] — update a pitch (spec §5, PR 2.10). Requires If-Match; a stale one
//                                 → 409. Optional Idempotency-Key. Scope pitches:write.

const paramsSchema = z.object({ id: z.uuid() });

export const GET = adminRoute<{ id: string }>(
  "admin.pitches.read",
  "pitches:write",
  async (_request, { params, sql }) => {
    const { id } = parseInput(paramsSchema, await params);
    const pitch = await sql.begin((tx) => readAdminPitch(tx, id));
    if (pitch === null) throw new ApiError("not_found");
    return Response.json({ pitch }, { headers: { etag: formatEtag(pitch.version) } });
  },
);

export const PATCH = adminRoute<{ id: string }>("admin.pitches.update", "pitches:write", async (request, context) => {
  const { id } = parseInput(paramsSchema, await context.params);
  const ifMatch = requireIfMatch(request);
  const { text, json } = await readJsonBody(request);
  const patch = parseInput(pitchPatchSchema, json);
  return runMutation(request, context, { body: text, ifMatch }, async (tx) => {
    const pitch = await updatePitch(tx, id, ifMatch, patch, context);
    return { status: 200, headers: { etag: formatEtag(pitch.version) }, body: { pitch } };
  });
});
