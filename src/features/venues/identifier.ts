import { z } from "zod";

// Path parameters for the detail endpoints (spec §5, PR 2.8): a venue or pitch is addressed by its
// uuid or by its slug. Anything that can't be either is rejected before the database is touched.
//
// Slugs and lowercase uuids share an alphabet, so a uuid-shaped value is always treated as an id.
// A slug that looks like a uuid could never be reached by slug; admin validation should reject those.

/** Same format as the venues_slug_format / pitches_slug_format CHECKs in migration 0001. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;

export type Identifier = { kind: "id"; id: string } | { kind: "slug"; slug: string };

export const identifierSchema = z.union([
  z.uuid().transform((id): Identifier => ({ kind: "id", id: id.toLowerCase() })),
  z
    .string()
    .max(MAX_SLUG_LENGTH)
    .regex(SLUG)
    .transform((slug): Identifier => ({ kind: "slug", slug })),
]);
