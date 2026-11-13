import { z } from "zod";

import { dbNumber, dbTimestamp } from "@/lib/db/row-types";

import { RIGHTS_BASES } from "./admin-schema";

// Admin media DTO (PR 2.12), built field by field (rule 3). It includes rights metadata and status
// but never the private storage key: admins don't need it, and it's the one value that could reach
// an unpublished image's bytes if storage access ever leaked.

/**
 * Why an image isn't shown anywhere public (PR 2.16, computed, never stored). Owner reasons come
 * first: the point is finding images left on archived or hidden places (Hugh, 2026-11-09).
 *   owner_archived   its venue or pitch is archived (or the pitch's venue is)
 *   owner_draft      its venue or pitch is a draft (or the pitch's venue is)
 *   owner_not_public its venue is published but has no published pitch, so the venue isn't public
 *   image_archived   the image itself is archived
 *   image_draft      the image itself is a draft
 */
export const UNUSED_REASONS = [
  "owner_archived",
  "owner_draft",
  "owner_not_public",
  "image_archived",
  "image_draft",
] as const;
export type UnusedReason = (typeof UNUSED_REASONS)[number];

const adminMediaRow = z.object({
  id: z.uuid(),
  venue_id: z.uuid().nullable(),
  pitch_id: z.uuid().nullable(),
  content_type: z.enum(["image/webp", "image/avif"]),
  width_px: dbNumber,
  height_px: dbNumber,
  byte_size: dbNumber,
  alt_text: z.string(),
  display_order: dbNumber,
  status: z.enum(["draft", "published", "archived"]),
  public_key: z.string().nullable(),
  rights_basis: z.enum(RIGHTS_BASES).nullable(),
  author: z.string().nullable(),
  source_url: z.string().nullable(),
  license_name: z.string().nullable(),
  license_url: z.string().nullable(),
  attribution_text: z.string().nullable(),
  evidence_ref: z.string().nullable(),
  commercial_use_ok: z.boolean().nullable(),
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
  version: z.string().regex(/^\d+$/),
  unused_reason: z.enum(UNUSED_REASONS).nullable(),
});

export interface AdminMediaDto {
  id: string;
  venueId: string | null;
  pitchId: string | null;
  contentType: "image/webp" | "image/avif";
  width: number;
  height: number;
  byteSize: number;
  alt: string;
  displayOrder: number;
  status: "draft" | "published" | "archived";
  /** Public URL while published; null otherwise. */
  publicUrl: string | null;
  rights: {
    basis: (typeof RIGHTS_BASES)[number] | null;
    author: string | null;
    sourceUrl: string | null;
    licenseName: string | null;
    licenseUrl: string | null;
    attributionText: string | null;
    evidenceRef: string | null;
    commercialUseOk: boolean | null;
  };
  createdAt: string;
  updatedAt: string;
  /** Send back as If-Match (it's also the ETag header). */
  version: string;
  /** True when the image isn't shown anywhere public (PR 2.16). */
  unused: boolean;
  /** Why it's unused; null when it's in use. */
  unusedReason: UnusedReason | null;
}

export function toAdminMediaDto(row: unknown, publicUrl: (key: string) => string): AdminMediaDto {
  const r = adminMediaRow.parse(row);
  return {
    id: r.id,
    venueId: r.venue_id,
    pitchId: r.pitch_id,
    contentType: r.content_type,
    width: r.width_px,
    height: r.height_px,
    byteSize: r.byte_size,
    alt: r.alt_text,
    displayOrder: r.display_order,
    status: r.status,
    publicUrl: r.public_key === null ? null : publicUrl(r.public_key),
    rights: {
      basis: r.rights_basis,
      author: r.author,
      sourceUrl: r.source_url,
      licenseName: r.license_name,
      licenseUrl: r.license_url,
      attributionText: r.attribution_text,
      evidenceRef: r.evidence_ref,
      commercialUseOk: r.commercial_use_ok,
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
    unused: r.unused_reason !== null,
    unusedReason: r.unused_reason,
  };
}
