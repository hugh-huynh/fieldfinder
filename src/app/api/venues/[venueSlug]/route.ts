import { z } from "zod";

import { DETAIL_CACHE_CONTROL, getVenueDetail } from "@/features/venues/detail";
import { slugSchema } from "@/features/venues/slug";
import { ApiError } from "@/lib/api/errors";
import { apiRoute, parseInput } from "@/lib/api/handler";
import { publicDb } from "@/lib/db/public";

// GET /api/venues/[venueSlug] — a published venue and its published pitches (spec §5, PR 2.8).
// Slug only, not id (decisions log, 2026-10-18). 404 for anything that isn't public, without saying why.

const paramsSchema = z.object({ venueSlug: slugSchema });

export const GET = apiRoute<{ venueSlug: string }>("venues.detail", async (_request, { params }) => {
  const { venueSlug } = parseInput(paramsSchema, await params);
  const body = await getVenueDetail(publicDb(), venueSlug);
  if (body === null) throw new ApiError("not_found");
  return Response.json(body, { headers: { "cache-control": DETAIL_CACHE_CONTROL } });
});
