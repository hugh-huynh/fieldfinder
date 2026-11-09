import { unpublishMedia } from "@/features/media/admin-service";
import { transitionSchema } from "@/features/venues/admin-publish";

import { mediaDeps } from "../../../_lib/media";
import { transitionRoute } from "../../../_lib/transition-route";

// POST /api/admin/media/[id]/unpublish — delete the public copy and return the image to draft (PR 2.12).
// Scope content:publish. Requires If-Match. Optional Idempotency-Key. Body: optional { "reason" }.

export const POST = transitionRoute({
  name: "admin.media.unpublish",
  schema: transitionSchema,
  optionalBody: true,
  run: async (tx, id, ifMatch, input, actor) => ({
    media: await unpublishMedia(tx, id, ifMatch, input.reason ?? null, actor, mediaDeps()),
  }),
  version: (result) => result.media.version,
});
