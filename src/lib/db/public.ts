import "server-only";

import { getSql, type Sql } from "./client";

/**
 * Connection as `ff_public_reader`: it can read only `public_venues_v`, `public_pitches_v`,
 * `public_media_v` and `search_venues()`. Use this for every public page and public API route.
 */
export function publicDb(): Sql {
  return getSql("public");
}
