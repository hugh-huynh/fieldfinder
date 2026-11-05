import "server-only";

import type { AdminPrincipal } from "@/lib/auth/admin";
import type { JsonValue, Tx } from "@/lib/db/types";

// field_revisions rows for admin mutations (PR 2.10). Written in the same transaction as the change
// they describe, so a change never lands without its history. Field names are database column
// names; values are the stored values.

export type Changes = Record<string, { from: unknown; to: unknown }>;

export type RevisionEntity = "venue" | "pitch" | "venue_amenity" | "field_verification";
export type RevisionAction = "create" | "update";

/** Fields of `next` that differ from `previous`. Absent (undefined) fields in `next` are unchanged. */
export function diff(previous: Record<string, unknown>, next: Record<string, unknown>): Changes {
  const changes: Changes = {};
  for (const [field, to] of Object.entries(next)) {
    if (to === undefined) continue;
    const from = previous[field] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

export async function recordRevision(
  tx: Tx,
  revision: {
    entityType: RevisionEntity;
    entityId: string;
    action: RevisionAction;
    changes: Changes;
    actor: AdminPrincipal;
    requestId: string;
  },
): Promise<void> {
  await tx`
    insert into public.field_revisions (entity_type, entity_id, action, actor_credential_id, actor_label, changes, request_id)
    values (
      ${revision.entityType}::public.audit_entity, ${revision.entityId}::uuid, ${revision.action}::public.audit_action,
      ${revision.actor.credentialId}::uuid, ${revision.actor.label}, ${tx.json(revision.changes as JsonValue)}::jsonb,
      ${revision.requestId}
    )
  `;
}
