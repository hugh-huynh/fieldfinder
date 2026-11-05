import "server-only";

import type { AdminPrincipal } from "@/lib/auth/admin";
import type { Tx } from "@/lib/db/types";

// field_publications rows (PR 2.11): one per status transition, written in the transaction that
// makes it. The entity's own `status` column stays the single source of truth (ADR-0002); this table
// is the history. The 0002 CHECK rejects a "transition" from a status to itself.

export type PublicationStatus = "draft" | "published" | "archived";

export async function recordPublication(
  tx: Tx,
  publication: {
    entityType: "venue" | "pitch";
    entityId: string;
    from: PublicationStatus;
    to: PublicationStatus;
    reason: string | null;
    actor: AdminPrincipal;
    requestId: string;
  },
): Promise<void> {
  await tx`
    insert into public.field_publications
      (entity_type, entity_id, from_status, to_status, actor_credential_id, actor_label, reason, request_id)
    values (
      ${publication.entityType}::public.publishable_entity, ${publication.entityId}::uuid,
      ${publication.from}::public.publication_status, ${publication.to}::public.publication_status,
      ${publication.actor.credentialId}::uuid, ${publication.actor.label}, ${publication.reason}, ${publication.requestId}
    )
  `;
}
