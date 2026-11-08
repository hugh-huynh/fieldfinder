import { publishVenue, venuePublishSchema } from "@/features/venues/admin-publish";

import { transitionRoute } from "../../../_lib/transition-route";

// POST /api/admin/venues/[id]/publish — publish the venue and the selected pitches. Body: { "pitches": [{ "id", "version" }], "reason"? }. Needs a verification (spec §5, PR 2.11).
// Scope content:publish. Requires If-Match. Optional Idempotency-Key.

export const POST = transitionRoute({
  name: "admin.venues.publish",
  schema: venuePublishSchema,
  optionalBody: false,
  run: publishVenue,
  version: (result) => result.venue.version,
});
