import "server-only";

import { getSql, type Sql } from "./client";

/**
 * Connection as `ff_admin_writer`. Only authenticated `/api/admin/*` handlers may use it; ESLint
 * blocks imports from anywhere else (ADR-0002).
 */
export function adminDb(): Sql {
  return getSql("admin");
}
