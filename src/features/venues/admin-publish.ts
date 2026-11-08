import "server-only";

import { z } from "zod";

import type { AdminPitchDto } from "@/features/pitches/admin-dto";
import { readAdminPitch } from "@/features/pitches/admin-service";
import { ApiError } from "@/lib/api/errors";
import { recordPublication, type PublicationStatus } from "@/lib/audit/publications";
import type { Tx } from "@/lib/db/types";

import type { AdminVenueDto } from "./admin-dto";
import { readAdminVenue, type Actor } from "./admin-service";
import { hasVenueVerification } from "./admin-verification";

// Venue publication transitions (spec §4–§5, PR 2.11). Decisions (Hugh, 2026-11-05):
//   * publish needs ≥1 verification for the venue and ≥1 selected pitch of this venue; nothing else
//     is required, so unknown attributes stay "Not confirmed" rather than being guessed;
//   * archiving a venue archives its pitches too, and is final through the API;
//   * media publishing arrives with storage in 2.12.
// Every transition takes If-Match (publish exactly what was reviewed), writes one field_publications
// row per entity whose status changes, and is a 409 when nothing would change.

const reason = z.string().trim().min(1).max(500).nullable().optional();

// Each selected pitch carries the version the publisher reviewed (its `version` / ETag). A pitch
// edit doesn't move the venue's version, so the venue's If-Match alone can't catch a pitch edited
// after review (Codex review, PR 2.11).
export const venuePublishSchema = z
  .object({
    pitches: z
      .array(z.object({ id: z.uuid(), version: z.string().regex(/^\d{1,20}$/) }).strict())
      .min(1)
      .max(50)
      .refine((pitches) => new Set(pitches.map((p) => p.id)).size === pitches.length, "must not repeat a pitch"),
    reason,
  })
  .strict();

export const transitionSchema = z.object({ reason }).strict();

export type VenuePublish = z.output<typeof venuePublishSchema>;
export type Transition = z.output<typeof transitionSchema>;

export interface VenueTransitionResult {
  venue: AdminVenueDto;
  /** All of the venue's pitches after the transition. */
  pitches: AdminPitchDto[];
}

async function lockVenue(tx: Tx, id: string, ifMatch: string): Promise<AdminVenueDto> {
  const [locked] = await tx`select id from public.venues where id = ${id}::uuid for update`;
  if (locked === undefined) throw new ApiError("not_found");
  const venue = await readAdminVenue(tx, id);
  if (venue === null) throw new ApiError("not_found");
  if (venue.version !== ifMatch) {
    throw new ApiError(
      "conflict",
      "This venue has changed since you read it. Fetch it again and retry with its new ETag.",
    );
  }
  if (venue.status === "archived") throw new ApiError("conflict", "An archived venue can't change status.");
  return venue;
}

async function setStatus(
  tx: Tx,
  entityType: "venue" | "pitch",
  id: string,
  from: PublicationStatus,
  to: PublicationStatus,
  reasonText: string | null,
  actor: Actor,
): Promise<void> {
  if (entityType === "venue") {
    await tx`update public.venues set status = ${to}::public.publication_status where id = ${id}::uuid`;
  } else {
    await tx`update public.pitches set status = ${to}::public.publication_status where id = ${id}::uuid`;
  }
  await recordPublication(tx, {
    entityType,
    entityId: id,
    from,
    to,
    reason: reasonText,
    actor: actor.admin,
    requestId: actor.requestId,
  });
}

async function result(tx: Tx, venueId: string): Promise<VenueTransitionResult> {
  const venue = await readAdminVenue(tx, venueId);
  if (venue === null) throw new Error("venue disappeared mid-transaction");
  const ids = await tx<
    { id: string }[]
  >`select id from public.pitches where venue_id = ${venueId}::uuid order by name, id`;
  const pitches: AdminPitchDto[] = [];
  for (const { id } of ids) {
    const pitch = await readAdminPitch(tx, id);
    if (pitch !== null) pitches.push(pitch);
  }
  return { venue, pitches };
}

export async function publishVenue(
  tx: Tx,
  id: string,
  ifMatch: string,
  input: VenuePublish,
  actor: Actor,
): Promise<VenueTransitionResult> {
  const venue = await lockVenue(tx, id, ifMatch);

  // Venue first (lockVenue), then the pitches in id order: the same order as every other
  // transition, so overlapping ones queue rather than deadlock.
  const ids = input.pitches.map((p) => p.id);
  const selected = await tx<{ id: string; venue_id: string; status: PublicationStatus; version: string }[]>`
    select id, venue_id, status, (extract(epoch from updated_at) * 1000000)::bigint::text as version
    from public.pitches where id = any(${ids}::uuid[]) order by id for update
  `;
  if (selected.length !== ids.length || selected.some((p) => p.venue_id !== id)) {
    throw new ApiError("invalid_request", "Every selected pitch must be a pitch of this venue.");
  }
  const reviewed = new Map(input.pitches.map((p) => [p.id, p.version]));
  if (selected.some((p) => reviewed.get(p.id) !== p.version)) {
    throw new ApiError(
      "conflict",
      "A selected pitch has changed since you read it. Fetch it again and retry with its new version.",
    );
  }
  if (selected.some((p) => p.status === "archived")) {
    throw new ApiError("conflict", "Archived pitches can't be published.");
  }
  if (!(await hasVenueVerification(tx, id))) {
    throw new ApiError("conflict", "Record a verification for this venue before publishing it.");
  }

  const pitchesToPublish = selected.filter((p) => p.status === "draft");
  if (venue.status === "published" && pitchesToPublish.length === 0) {
    throw new ApiError("conflict", "The venue and every selected pitch are already published.");
  }

  const reasonText = input.reason ?? null;
  if (venue.status === "draft") await setStatus(tx, "venue", id, "draft", "published", reasonText, actor);
  for (const pitch of pitchesToPublish) await setStatus(tx, "pitch", pitch.id, "draft", "published", reasonText, actor);
  return result(tx, id);
}

export async function unpublishVenue(
  tx: Tx,
  id: string,
  ifMatch: string,
  input: Transition,
  actor: Actor,
): Promise<VenueTransitionResult> {
  const venue = await lockVenue(tx, id, ifMatch);
  if (venue.status !== "published") throw new ApiError("conflict", "The venue isn't published.");
  // Its pitches keep their status: the public views hide every pitch of an unpublished venue.
  await setStatus(tx, "venue", id, "published", "draft", input.reason ?? null, actor);
  return result(tx, id);
}

export async function archiveVenue(
  tx: Tx,
  id: string,
  ifMatch: string,
  input: Transition,
  actor: Actor,
): Promise<VenueTransitionResult> {
  const venue = await lockVenue(tx, id, ifMatch);
  const reasonText = input.reason ?? null;
  const pitches = await tx<{ id: string; status: PublicationStatus }[]>`
    select id, status from public.pitches where venue_id = ${id}::uuid and status <> 'archived' order by id for update
  `;
  await setStatus(tx, "venue", id, venue.status, "archived", reasonText, actor);
  for (const pitch of pitches) await setStatus(tx, "pitch", pitch.id, pitch.status, "archived", reasonText, actor);
  return result(tx, id);
}
