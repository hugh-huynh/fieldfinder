import { unpublishVenue, transitionSchema } from "@/features/venues/admin-publish";

import { mediaDeps } from "../../../_lib/media";
import { transitionRoute } from "../../../_lib/transition-route";

// POST /api/admin/venues/[id]/unpublish — take the venue back to draft. Body: optional { "reason" } (spec §5, PR 2.11).
// Scope content:publish. Requires If-Match. Optional Idempotency-Key.

export const POST = transitionRoute({
  name: "admin.venues.unpublish",
  schema: transitionSchema,
  optionalBody: true,
  run: (tx, id, ifMatch, input, actor) => unpublishVenue(tx, id, ifMatch, input, actor, mediaDeps),
  version: (result) => result.venue.version,
});
