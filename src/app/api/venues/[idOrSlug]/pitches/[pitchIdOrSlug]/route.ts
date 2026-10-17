import { z } from "zod";

import { DETAIL_CACHE_CONTROL, getPitchDetail } from "@/features/venues/detail";
import { identifierSchema } from "@/features/venues/identifier";
import { ApiError } from "@/lib/api/errors";
import { apiRoute, parseInput } from "@/lib/api/handler";
import { publicDb } from "@/lib/db/public";

// GET /api/venues/[idOrSlug]/pitches/[pitchIdOrSlug] — a published pitch with its venue's public
// details (spec §5, PR 2.8). The spec names the venue segment [venueIdOrSlug]; Next.js needs one
// name per segment level, so it shares [idOrSlug] with the venue route. 404 for anything not public.

const paramsSchema = z.object({ idOrSlug: identifierSchema, pitchIdOrSlug: identifierSchema });

export const GET = apiRoute<{ idOrSlug: string; pitchIdOrSlug: string }>(
  "pitches.detail",
  async (_request, { params }) => {
    const { idOrSlug, pitchIdOrSlug } = parseInput(paramsSchema, await params);
    const body = await getPitchDetail(publicDb(), idOrSlug, pitchIdOrSlug);
    if (body === null) throw new ApiError("not_found");
    return Response.json(body, { headers: { "cache-control": DETAIL_CACHE_CONTROL } });
  },
);
