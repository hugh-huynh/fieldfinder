import { z } from "zod";

import { DETAIL_CACHE_CONTROL, getVenueDetail } from "@/features/venues/detail";
import { identifierSchema } from "@/features/venues/identifier";
import { ApiError } from "@/lib/api/errors";
import { apiRoute, parseInput } from "@/lib/api/handler";
import { publicDb } from "@/lib/db/public";

// GET /api/venues/[idOrSlug] — a published venue and its published pitches (spec §5, PR 2.8).
// 404 for anything that isn't public, without saying why.

const paramsSchema = z.object({ idOrSlug: identifierSchema });

export const GET = apiRoute<{ idOrSlug: string }>("venues.detail", async (_request, { params }) => {
  const { idOrSlug } = parseInput(paramsSchema, await params);
  const body = await getVenueDetail(publicDb(), idOrSlug);
  if (body === null) throw new ApiError("not_found");
  return Response.json(body, { headers: { "cache-control": DETAIL_CACHE_CONTROL } });
});
