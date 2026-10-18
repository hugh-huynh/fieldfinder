import { z } from "zod";

// Path parameter for the public detail endpoints (PR 2.8): venues and pitches are addressed by slug
// only, never by id (decisions log, 2026-10-18). Anything that can't be a slug is rejected before
// the database is touched. A uuid-shaped value is just a slug like any other.

/** Same format as the venues_slug_format / pitches_slug_format CHECKs in migration 0001. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;

export const slugSchema = z.string().max(MAX_SLUG_LENGTH).regex(SLUG);
