import type { AdminScope } from "@/lib/auth/scopes";

// Every API operation's name, in one place. The name is the route's log label (`apiRoute`,
// `adminRoute`) and its OpenAPI operationId (src/lib/openapi/document.ts), so a misspelling is a type
// error. An admin operation's scope lives here too: `adminRoute` enforces it and the contract
// documents it from the same entry. No `server-only` import: the OpenAPI build reads this file.
// Routing still comes from the folder path; src/lib/openapi/document.test.ts checks that each route
// file uses the name its path has in the contract.

export const PUBLIC_OPERATIONS = ["venues.search", "venues.detail", "pitches.detail", "locations.suggest"] as const;

export const ADMIN_OPERATIONS = {
  "admin.venues.create": "venues:write",
  "admin.venues.read": "venues:write",
  "admin.venues.update": "venues:write",
  "admin.venues.verify": "venues:write",
  "admin.venues.publish": "content:publish",
  "admin.venues.unpublish": "content:publish",
  "admin.venues.archive": "content:publish",
  "admin.pitches.create": "pitches:write",
  "admin.pitches.read": "pitches:write",
  "admin.pitches.update": "pitches:write",
  "admin.pitches.publish": "content:publish",
  "admin.pitches.unpublish": "content:publish",
  "admin.pitches.archive": "content:publish",
  "admin.media.unused": "media:write",
  "admin.media.upload": "media:write",
  "admin.media.read": "media:write",
  "admin.media.update": "media:write",
  "admin.media.publish": "content:publish",
  "admin.media.unpublish": "content:publish",
} as const satisfies Record<`admin.${string}`, AdminScope>;

export type PublicOperation = (typeof PUBLIC_OPERATIONS)[number];
export type AdminOperation = keyof typeof ADMIN_OPERATIONS;
export type Operation = PublicOperation | AdminOperation;

/** The admin operations that need `scope`, e.g. the publish/unpublish/archive transitions. */
export type AdminOperationWithScope<Scope extends AdminScope> = {
  [K in AdminOperation]: (typeof ADMIN_OPERATIONS)[K] extends Scope ? K : never;
}[AdminOperation];

export function adminScope(operation: AdminOperation): AdminScope {
  return ADMIN_OPERATIONS[operation];
}
