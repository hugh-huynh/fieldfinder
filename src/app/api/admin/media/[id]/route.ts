import { z } from "zod";

import { mediaPatchSchema } from "@/features/media/admin-schema";
import { readAdminMedia, updateMedia } from "@/features/media/admin-service";
import { readJsonBody } from "@/lib/api/body";
import { ApiError } from "@/lib/api/errors";
import { parseInput } from "@/lib/api/handler";
import { formatEtag, requireIfMatch } from "@/lib/api/version";

import { adminRoute } from "../../_lib/admin-route";
import { mediaDeps } from "../../_lib/media";
import { runMutation } from "../../_lib/mutation";

// GET   /api/admin/media/[id] — the admin view of an image, with its ETag.
// PATCH /api/admin/media/[id] — alt text, display order and rights (PR 2.12). Rights may be completed
//                               after upload; a published image must keep satisfying the publish gate.
//                               Requires If-Match. Optional Idempotency-Key. Scope media:write.

const paramsSchema = z.object({ id: z.uuid() });

export const GET = adminRoute<{ id: string }>("admin.media.read", "media:write", async (_request, { params, sql }) => {
  const { id } = parseInput(paramsSchema, await params);
  const deps = mediaDeps();
  const media = await sql.begin((tx) => readAdminMedia(tx, id, deps));
  if (media === null) throw new ApiError("not_found");
  return Response.json({ media }, { headers: { etag: formatEtag(media.version) } });
});

export const PATCH = adminRoute<{ id: string }>("admin.media.update", "media:write", async (request, context) => {
  const { id } = parseInput(paramsSchema, await context.params);
  const ifMatch = requireIfMatch(request);
  const { text, json } = await readJsonBody(request);
  const patch = parseInput(mediaPatchSchema, json);
  const deps = mediaDeps();
  return runMutation(request, context, { body: text, ifMatch }, async (tx) => {
    const media = await updateMedia(tx, id, ifMatch, patch, context, deps);
    return { status: 200, headers: { etag: formatEtag(media.version) }, body: { media } };
  });
});
