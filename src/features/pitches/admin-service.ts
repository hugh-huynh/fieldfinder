import "server-only";

import type { Actor } from "@/features/venues/admin-service";
import { ApiError } from "@/lib/api/errors";
import { diff, recordRevision } from "@/lib/audit/revisions";
import { isUniqueViolation } from "@/lib/db/errors";
import type { Tx } from "@/lib/db/types";

import { toAdminPitchDto, type AdminPitchDto } from "./admin-dto";
import { PITCH_COLUMNS, type PitchCreate, type PitchPatch } from "./admin-schema";

// Admin pitch writes (PR 2.10). Same rules as venues: one transaction per request, revisions in that
// transaction, new pitches are drafts, slugs fixed once published (D18), archived records read-only.

const SLUG_TAKEN = "This venue already has a pitch with this slug.";

export async function readAdminPitch(tx: Tx, id: string): Promise<AdminPitchDto | null> {
  const [row] = await tx`
    select p.id, p.venue_id, p.slug, p.name, p.surface, p.pitch_format, p.length_m, p.width_m, p.floodlights,
           p.access, p.status, p.created_at, p.updated_at,
           (extract(epoch from p.updated_at) * 1000000)::bigint::text as version
    from public.pitches p
    where p.id = ${id}::uuid
  `;
  return row === undefined ? null : toAdminPitchDto(row);
}

async function everPublished(tx: Tx, id: string, status: string): Promise<boolean> {
  if (status !== "draft") return true;
  const [row] = await tx<{ published: boolean }[]>`
    select exists (
      select 1 from public.field_publications
      where entity_type = 'pitch' and entity_id = ${id}::uuid and to_status = 'published'
    ) as published
  `;
  return row?.published === true;
}

function columnValues(input: PitchPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(PITCH_COLUMNS)) {
    const value = input[field as keyof typeof PITCH_COLUMNS];
    if (value !== undefined) values[column] = value;
  }
  return values;
}

export async function createPitch(tx: Tx, venueId: string, input: PitchCreate, actor: Actor): Promise<AdminPitchDto> {
  // Lock the venue so it can't be archived while a pitch is being added to it.
  const [venue] = await tx<{ status: string }[]>`
    select status from public.venues where id = ${venueId}::uuid for share
  `;
  if (venue === undefined) throw new ApiError("not_found");
  if (venue.status === "archived") throw new ApiError("conflict", "Pitches can't be added to an archived venue.");

  const values = { venue_id: venueId, ...columnValues(input) };
  let id: string;
  try {
    const [row] = await tx<{ id: string }[]>`insert into public.pitches ${tx(values)} returning id`;
    if (row === undefined) throw new Error("insert returned no row");
    id = row.id;
  } catch (error) {
    if (isUniqueViolation(error, "pitches_venue_slug_key")) throw new ApiError("conflict", SLUG_TAKEN);
    throw error;
  }

  await recordRevision(tx, {
    entityType: "pitch",
    entityId: id,
    action: "create",
    changes: diff({}, { ...values, status: "draft" }),
    actor: actor.admin,
    requestId: actor.requestId,
  });

  const pitch = await readAdminPitch(tx, id);
  if (pitch === null) throw new Error("created pitch not found");
  return pitch;
}

export async function updatePitch(
  tx: Tx,
  id: string,
  ifMatch: string,
  patch: PitchPatch,
  actor: Actor,
): Promise<AdminPitchDto> {
  const [locked] = await tx`select id from public.pitches where id = ${id}::uuid for update`;
  if (locked === undefined) throw new ApiError("not_found");
  const current = await readAdminPitch(tx, id);
  if (current === null) throw new ApiError("not_found");

  if (current.version !== ifMatch) {
    throw new ApiError(
      "conflict",
      "This pitch has changed since you read it. Fetch it again and retry with its new ETag.",
    );
  }
  if (current.status === "archived") throw new ApiError("conflict", "An archived pitch can't be edited.");

  const changes = diff(columnValues(current), columnValues(patch));
  if (changes.slug !== undefined && (await everPublished(tx, id, current.status))) {
    throw new ApiError("conflict", "A pitch's slug can't change once it has been published.");
  }
  if (Object.keys(changes).length === 0) return current; // nothing to do

  const changedColumns = Object.fromEntries(Object.entries(changes).map(([column, { to }]) => [column, to]));
  try {
    await tx`update public.pitches set ${tx(changedColumns)} where id = ${id}::uuid`;
  } catch (error) {
    if (isUniqueViolation(error, "pitches_venue_slug_key")) throw new ApiError("conflict", SLUG_TAKEN);
    throw error;
  }

  await recordRevision(tx, {
    entityType: "pitch",
    entityId: id,
    action: "update",
    changes,
    actor: actor.admin,
    requestId: actor.requestId,
  });

  const updated = await readAdminPitch(tx, id);
  if (updated === null) throw new Error("updated pitch not found");
  return updated;
}
