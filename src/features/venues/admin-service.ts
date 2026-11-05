import "server-only";

import { ApiError } from "@/lib/api/errors";
import { diff, recordRevision } from "@/lib/audit/revisions";
import type { AdminPrincipal } from "@/lib/auth/admin";
import { isUniqueViolation } from "@/lib/db/errors";
import type { Tx } from "@/lib/db/types";
import type { AmenityKey } from "@/lib/domain/enums";

import { toAdminVenueDto, type AdminVenueDto } from "./admin-dto";
import { VENUE_COLUMNS, type AmenityState, type VenueCreate, type VenuePatch } from "./admin-schema";

// Admin venue writes (PR 2.10). Every function runs inside the caller's transaction, and every change
// writes its field_revisions rows in that same transaction. New venues are drafts; status changes
// belong to the publish workflow (2.11).

export interface Actor {
  admin: AdminPrincipal;
  requestId: string;
}

const SLUG_TAKEN = "A venue with this slug already exists.";

/** The admin view of one venue, or null. `version` is updated_at in whole microseconds. */
export async function readAdminVenue(tx: Tx, id: string): Promise<AdminVenueDto | null> {
  const [row] = await tx`
    select v.id, v.slug, v.name, v.street_address, v.suburb, v.state, v.postcode, v.latitude, v.longitude,
           v.description, v.access, v.status, v.created_at, v.updated_at,
           (extract(epoch from v.updated_at) * 1000000)::bigint::text as version,
           coalesce(
             (select jsonb_object_agg(a.amenity, a.state) from public.venue_amenities a where a.venue_id = v.id),
             '{}'::jsonb
           ) as amenities
    from public.venues v
    where v.id = ${id}::uuid
  `;
  return row === undefined ? null : toAdminVenueDto(row);
}

/** True once a venue has been published, now or in the past: its slug is then fixed (D18). */
async function everPublished(tx: Tx, id: string, status: string): Promise<boolean> {
  if (status !== "draft") return true;
  const [row] = await tx<{ published: boolean }[]>`
    select exists (
      select 1 from public.field_publications
      where entity_type = 'venue' and entity_id = ${id}::uuid and to_status = 'published'
    ) as published
  `;
  return row?.published === true;
}

function columnValues(input: VenuePatch): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(VENUE_COLUMNS)) {
    const value = input[field as keyof typeof VENUE_COLUMNS];
    if (value !== undefined) values[column] = value;
  }
  return values;
}

async function writeAmenities(
  tx: Tx,
  venueId: string,
  current: Partial<Record<AmenityKey, AmenityState>>,
  next: Partial<Record<AmenityKey, AmenityState>>,
  action: "create" | "update",
  actor: Actor,
): Promise<number> {
  let changed = 0;
  for (const [amenity, state] of Object.entries(next) as [AmenityKey, AmenityState][]) {
    const from = current[amenity] ?? (action === "create" ? null : "unknown");
    if (from === state) continue;
    await tx`
      insert into public.venue_amenities (venue_id, amenity, state)
      values (${venueId}::uuid, ${amenity}::public.amenity_key, ${state}::public.tri_state)
      on conflict (venue_id, amenity) do update set state = excluded.state
    `;
    await recordRevision(tx, {
      entityType: "venue_amenity",
      entityId: venueId,
      action,
      changes: { [amenity]: { from, to: state } },
      actor: actor.admin,
      requestId: actor.requestId,
    });
    changed += 1;
  }
  return changed;
}

export async function createVenue(tx: Tx, input: VenueCreate, actor: Actor): Promise<AdminVenueDto> {
  const values = columnValues(input);
  let id: string;
  try {
    const [row] = await tx<{ id: string }[]>`insert into public.venues ${tx(values)} returning id`;
    if (row === undefined) throw new Error("insert returned no row");
    id = row.id;
  } catch (error) {
    if (isUniqueViolation(error, "venues_slug_key")) throw new ApiError("conflict", SLUG_TAKEN);
    throw error;
  }

  await recordRevision(tx, {
    entityType: "venue",
    entityId: id,
    action: "create",
    changes: diff({}, { ...values, status: "draft" }),
    actor: actor.admin,
    requestId: actor.requestId,
  });
  await writeAmenities(tx, id, {}, input.amenities ?? {}, "create", actor);

  const venue = await readAdminVenue(tx, id);
  if (venue === null) throw new Error("created venue not found");
  return venue;
}

export async function updateVenue(
  tx: Tx,
  id: string,
  ifMatch: string,
  patch: VenuePatch,
  actor: Actor,
): Promise<AdminVenueDto> {
  // Lock the row first so the version check and the write see the same state.
  const [locked] = await tx`select id from public.venues where id = ${id}::uuid for update`;
  if (locked === undefined) throw new ApiError("not_found");
  const current = await readAdminVenue(tx, id);
  if (current === null) throw new ApiError("not_found");

  if (current.version !== ifMatch) {
    throw new ApiError(
      "conflict",
      "This venue has changed since you read it. Fetch it again and retry with its new ETag.",
    );
  }
  if (current.status === "archived") throw new ApiError("conflict", "An archived venue can't be edited.");

  const previous = columnValues(current);
  const changes = diff(previous, columnValues(patch));
  if (changes.slug !== undefined && (await everPublished(tx, id, current.status))) {
    throw new ApiError("conflict", "A venue's slug can't change once it has been published.");
  }

  const changedColumns = Object.fromEntries(Object.entries(changes).map(([column, { to }]) => [column, to]));
  const amenityChanges = await writeAmenities(tx, id, current.amenities, patch.amenities ?? {}, "update", actor);
  if (Object.keys(changes).length === 0 && amenityChanges === 0) return current; // nothing to do

  try {
    // Always touch the venue row, so an amenity-only change still moves the version.
    if (Object.keys(changedColumns).length > 0) {
      await tx`update public.venues set ${tx(changedColumns)} where id = ${id}::uuid`;
    } else {
      await tx`update public.venues set updated_at = now() where id = ${id}::uuid`;
    }
  } catch (error) {
    if (isUniqueViolation(error, "venues_slug_key")) throw new ApiError("conflict", SLUG_TAKEN);
    throw error;
  }

  if (Object.keys(changes).length > 0) {
    await recordRevision(tx, {
      entityType: "venue",
      entityId: id,
      action: "update",
      changes,
      actor: actor.admin,
      requestId: actor.requestId,
    });
  }

  const updated = await readAdminVenue(tx, id);
  if (updated === null) throw new Error("updated venue not found");
  return updated;
}
