// Admin scope vocabulary (ADR-0003, PR 2.9). Migration 0002 only checks the format
// (`^[a-z]+(:[a-z]+)?$`); this list decides which scopes exist. No `server-only` import: the
// credential script validates against it too.

export const ADMIN_SCOPES = [
  /** Create and edit venues and their amenities (2.10). */
  "venues:write",
  /** Create and edit pitches (2.10). */
  "pitches:write",
  /** Upload and manage images (2.12). */
  "media:write",
  /** Publish, unpublish and archive venues, pitches and media (2.11). */
  "content:publish",
] as const;

export type AdminScope = (typeof ADMIN_SCOPES)[number];

export function isAdminScope(value: string): value is AdminScope {
  return (ADMIN_SCOPES as readonly string[]).includes(value);
}
