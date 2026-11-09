import { publishMedia } from "@/features/media/admin-service";
import { transitionSchema } from "@/features/venues/admin-publish";

import { mediaDeps } from "../../../_lib/media";
import { transitionRoute } from "../../../_lib/transition-route";

// POST /api/admin/media/[id]/publish — copy the image to the public bucket under an unguessable key; needs complete rights (ADR-0006) (PR 2.12).
// Scope content:publish. Requires If-Match. Optional Idempotency-Key. Body: optional { "reason" }.

export const POST = transitionRoute({
  name: "admin.media.publish",
  schema: transitionSchema,
  optionalBody: true,
  run: async (tx, id, ifMatch, input, actor) => ({
    media: await publishMedia(tx, id, ifMatch, input.reason ?? null, actor, mediaDeps()),
  }),
  version: (result) => result.media.version,
});
