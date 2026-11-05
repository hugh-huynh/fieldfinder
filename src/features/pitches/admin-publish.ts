import "server-only";

import type { Actor } from "@/features/venues/admin-service";
import type { Transition } from "@/features/venues/admin-publish";
import { ApiError } from "@/lib/api/errors";
import { recordPublication, type PublicationStatus } from "@/lib/audit/publications";
import type { Tx } from "@/lib/db/types";

import type { AdminPitchDto } from "./admin-dto";
import { readAdminPitch } from "./admin-service";

// Pitch publication transitions (spec §5 "optional independent pitch publishing when policy
// permits", PR 2.11). Policy: a pitch can be published on its own only once its venue is published
// (the venue's verification gate then already applies). If-Match, one field_publications row per
// transition, 409 when nothing would change. Archiving is final through the API.

async function lockPitch(tx: Tx, id: string, ifMatch: string): Promise<AdminPitchDto> {
  const [locked] = await tx`select id from public.pitches where id = ${id}::uuid for update`;
  if (locked === undefined) throw new ApiError("not_found");
  const pitch = await readAdminPitch(tx, id);
  if (pitch === null) throw new ApiError("not_found");
  if (pitch.version !== ifMatch) {
    throw new ApiError(
      "conflict",
      "This pitch has changed since you read it. Fetch it again and retry with its new ETag.",
    );
  }
  if (pitch.status === "archived") throw new ApiError("conflict", "An archived pitch can't change status.");
  return pitch;
}

async function transition(
  tx: Tx,
  pitch: AdminPitchDto,
  to: PublicationStatus,
  input: Transition,
  actor: Actor,
): Promise<AdminPitchDto> {
  await tx`update public.pitches set status = ${to}::public.publication_status where id = ${pitch.id}::uuid`;
  await recordPublication(tx, {
    entityType: "pitch",
    entityId: pitch.id,
    from: pitch.status,
    to,
    reason: input.reason ?? null,
    actor: actor.admin,
    requestId: actor.requestId,
  });
  const updated = await readAdminPitch(tx, pitch.id);
  if (updated === null) throw new Error("pitch disappeared mid-transaction");
  return updated;
}

export async function publishPitch(tx: Tx, id: string, ifMatch: string, input: Transition, actor: Actor) {
  const pitch = await lockPitch(tx, id, ifMatch);
  if (pitch.status === "published") throw new ApiError("conflict", "The pitch is already published.");
  const [venue] = await tx<{ status: string }[]>`
    select status from public.venues where id = ${pitch.venueId}::uuid for share
  `;
  if (venue?.status !== "published") {
    throw new ApiError("conflict", "Publish the venue first, selecting this pitch.");
  }
  return transition(tx, pitch, "published", input, actor);
}

export async function unpublishPitch(tx: Tx, id: string, ifMatch: string, input: Transition, actor: Actor) {
  const pitch = await lockPitch(tx, id, ifMatch);
  if (pitch.status !== "published") throw new ApiError("conflict", "The pitch isn't published.");
  // If this was the venue's last published pitch, the venue drops out of public search and pages too
  // (public_venues_v needs ≥1 published pitch) until another is published.
  return transition(tx, pitch, "draft", input, actor);
}

export async function archivePitch(tx: Tx, id: string, ifMatch: string, input: Transition, actor: Actor) {
  const pitch = await lockPitch(tx, id, ifMatch);
  return transition(tx, pitch, "archived", input, actor);
}
