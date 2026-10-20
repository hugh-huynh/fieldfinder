import { z } from "zod";

import { DETAIL_CACHE_CONTROL, getPitchDetail } from "@/features/venues/detail";
import { slugSchema } from "@/features/venues/slug";
import { ApiError } from "@/lib/api/errors";
import { apiRoute, parseInput } from "@/lib/api/handler";
import { publicDb } from "@/lib/db/public";

// GET /api/venues/[venueSlug]/pitches/[pitchSlug] — a published pitch with its venue's public details
// (spec §5, PR 2.8). Slugs only, not ids (decisions log, 2026-10-18). 404 for anything not public.

const paramsSchema = z.object({ venueSlug: slugSchema, pitchSlug: slugSchema });

export const GET = apiRoute<{ venueSlug: string; pitchSlug: string }>(
  "pitches.detail",
  async (_request, { params }) => {
    const { venueSlug, pitchSlug } = parseInput(paramsSchema, await params);
    const body = await getPitchDetail(publicDb(), venueSlug, pitchSlug);
    if (body === null) throw new ApiError("not_found");
    return Response.json(body, { headers: { "cache-control": DETAIL_CACHE_CONTROL } });
  },
);
