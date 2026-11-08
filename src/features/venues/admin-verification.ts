import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { diff, recordRevision } from "@/lib/audit/revisions";
import type { Tx } from "@/lib/db/types";

import type { Actor } from "./admin-service";

// Venue verifications (PR 2.11): who confirmed a venue's details, when, how sure, and from what
// source. Publishing a venue requires at least one (Hugh, 2026-11-05: "provenance only"). Every field
// here is internal: the public views never select from field_verifications (spec §6, ADR-0002).

const CONFIDENCE = ["low", "medium", "high"] as const;

export const verificationCreateSchema = z
  .object({
    verifiedBy: z.string().trim().min(1).max(100),
    /** YYYY-MM-DD, not in the future. */
    verifiedOn: z.iso.date().refine((date) => date <= new Date().toISOString().slice(0, 10), "can't be in the future"),
    confidence: z.enum(CONFIDENCE),
    evidence: z.string().trim().min(1).max(2000).nullable().optional(),
    internalNotes: z.string().trim().min(1).max(5000).nullable().optional(),
    sourceId: z.uuid().nullable().optional(),
  })
  .strict();

export type VerificationCreate = z.output<typeof verificationCreateSchema>;

const verificationRow = z.object({
  id: z.uuid(),
  venue_id: z.uuid(),
  source_id: z.uuid().nullable(),
  verified_by: z.string(),
  verified_on: z.string(),
  confidence: z.enum(CONFIDENCE),
  evidence: z.string().nullable(),
  internal_notes: z.string().nullable(),
  created_at: z.coerce.date().transform((d) => d.toISOString()),
});

/** Admin-only. Never returned by a public route. */
export interface AdminVerificationDto {
  id: string;
  venueId: string;
  sourceId: string | null;
  verifiedBy: string;
  verifiedOn: string;
  confidence: (typeof CONFIDENCE)[number];
  evidence: string | null;
  internalNotes: string | null;
  createdAt: string;
}

function toDto(row: unknown): AdminVerificationDto {
  const r = verificationRow.parse(row);
  return {
    id: r.id,
    venueId: r.venue_id,
    sourceId: r.source_id,
    verifiedBy: r.verified_by,
    verifiedOn: r.verified_on,
    confidence: r.confidence,
    evidence: r.evidence,
    internalNotes: r.internal_notes,
    createdAt: r.created_at,
  };
}

export async function createVenueVerification(
  tx: Tx,
  venueId: string,
  input: VerificationCreate,
  actor: Actor,
): Promise<AdminVerificationDto> {
  const [venue] = await tx<
    { status: string }[]
  >`select status from public.venues where id = ${venueId}::uuid for share`;
  if (venue === undefined) throw new ApiError("not_found");
  if (venue.status === "archived") throw new ApiError("conflict", "An archived venue can't be verified.");

  if (input.sourceId != null) {
    const [source] = await tx`select 1 from public.field_sources where id = ${input.sourceId}::uuid`;
    if (source === undefined) throw new ApiError("invalid_request", "Invalid request parameters: sourceId");
  }

  const values = {
    venue_id: venueId,
    source_id: input.sourceId ?? null,
    verified_by: input.verifiedBy,
    verified_on: input.verifiedOn,
    confidence: input.confidence,
    evidence: input.evidence ?? null,
    internal_notes: input.internalNotes ?? null,
  };
  const [row] = await tx`
    insert into public.field_verifications ${tx(values)}
    returning id, venue_id, source_id, verified_by, verified_on::text as verified_on, confidence, evidence,
              internal_notes, created_at
  `;
  const verification = toDto(row);

  // The revision records that a verification was added, not its internal notes or evidence text.
  await recordRevision(tx, {
    entityType: "field_verification",
    entityId: verification.id,
    action: "create",
    changes: diff(
      {},
      {
        venue_id: venueId,
        source_id: values.source_id,
        verified_by: values.verified_by,
        verified_on: values.verified_on,
        confidence: values.confidence,
      },
    ),
    actor: actor.admin,
    requestId: actor.requestId,
  });
  return verification;
}

export async function hasVenueVerification(tx: Tx, venueId: string): Promise<boolean> {
  const [row] = await tx<{ verified: boolean }[]>`
    select exists (select 1 from public.field_verifications where venue_id = ${venueId}::uuid) as verified
  `;
  return row?.verified === true;
}
