import { unpublishPitch } from "@/features/pitches/admin-publish";
import { transitionSchema } from "@/features/venues/admin-publish";

import { transitionRoute } from "../../../_lib/transition-route";

// POST /api/admin/pitches/[id]/unpublish — take the pitch back to draft (spec §5, PR 2.11).
// Scope content:publish. Requires If-Match. Optional Idempotency-Key. Body: optional { "reason" }.

export const POST = transitionRoute({
  name: "admin.pitches.unpublish",
  schema: transitionSchema,
  optionalBody: true,
  run: async (tx, id, ifMatch, input, actor) => ({ pitch: await unpublishPitch(tx, id, ifMatch, input, actor) }),
  version: (result) => result.pitch.version,
});
