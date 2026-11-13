import { z } from "zod";

import { venuePatchSchema } from "@/features/venues/admin-schema";
import { readAdminVenue, updateVenue } from "@/features/venues/admin-service";
import { readJsonBody } from "@/lib/api/body";
import { ApiError } from "@/lib/api/errors";
import { parseInput } from "@/lib/api/handler";
import { formatEtag, requireIfMatch } from "@/lib/api/version";

import { adminRoute } from "../../_lib/admin-route";
import { runMutation } from "../../_lib/mutation";

// GET   /api/admin/venues/[id] — the admin view of a venue, with its ETag (needed before a PATCH).
// PATCH /api/admin/venues/[id] — update fields and amenities (spec §5, PR 2.10). Requires If-Match;
//                                 a stale one → 409. Optional Idempotency-Key. Scope venues:write.

const paramsSchema = z.object({ id: z.uuid() });

export const GET = adminRoute<{ id: string }>("admin.venues.read", async (_request, { params, sql }) => {
  const { id } = parseInput(paramsSchema, await params);
  const venue = await sql.begin((tx) => readAdminVenue(tx, id));
  if (venue === null) throw new ApiError("not_found");
  return Response.json({ venue }, { headers: { etag: formatEtag(venue.version) } });
});

export const PATCH = adminRoute<{ id: string }>("admin.venues.update", async (request, context) => {
  const { id } = parseInput(paramsSchema, await context.params);
  const ifMatch = requireIfMatch(request);
  const { text, json } = await readJsonBody(request);
  const patch = parseInput(venuePatchSchema, json);
  return runMutation(request, context, { body: text, ifMatch }, async (tx) => {
    const venue = await updateVenue(tx, id, ifMatch, patch, context);
    return { status: 200, headers: { etag: formatEtag(venue.version) }, body: { venue } };
  });
});
