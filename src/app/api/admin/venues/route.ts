import { venueCreateSchema } from "@/features/venues/admin-schema";
import { createVenue } from "@/features/venues/admin-service";
import { readJsonBody } from "@/lib/api/body";
import { parseInput } from "@/lib/api/handler";
import { formatEtag } from "@/lib/api/version";

import { adminRoute } from "../_lib/admin-route";
import { runMutation } from "../_lib/mutation";

// POST /api/admin/venues — create a draft venue (spec §5, PR 2.10). Scope venues:write.
// Optional Idempotency-Key. 201 with the venue, its ETag and Location.

export const POST = adminRoute("admin.venues.create", async (request, context) => {
  const { text, json } = await readJsonBody(request);
  const input = parseInput(venueCreateSchema, json);
  return runMutation(request, context, { body: text, ifMatch: null }, async (tx) => {
    const venue = await createVenue(tx, input, context);
    return {
      status: 201,
      headers: { etag: formatEtag(venue.version), location: `/api/admin/venues/${venue.id}` },
      body: { venue },
    };
  });
});
