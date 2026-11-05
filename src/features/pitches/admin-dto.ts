import { z } from "zod";

import { dbNumber, dbTimestamp } from "@/lib/db/row-types";
import {
  ACCESS_CLASSES,
  PITCH_FORMATS,
  SURFACES,
  type AccessClass,
  type PitchFormat,
  type Surface,
} from "@/lib/domain/enums";

// Admin pitch DTO (PR 2.10), built field by field like the public one (CLAUDE.md rule 3).

const adminPitchRow = z.object({
  id: z.uuid(),
  venue_id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  surface: z.enum(SURFACES).nullable(),
  pitch_format: z.enum(PITCH_FORMATS).nullable(),
  length_m: dbNumber.nullable(),
  width_m: dbNumber.nullable(),
  floodlights: z.boolean().nullable(),
  access: z.enum(ACCESS_CLASSES).nullable(),
  status: z.enum(["draft", "published", "archived"]),
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
  version: z.string().regex(/^\d+$/),
});

export interface AdminPitchDto {
  id: string;
  venueId: string;
  slug: string;
  name: string;
  surface: Surface | null;
  pitchFormat: PitchFormat | null;
  lengthMeters: number | null;
  widthMeters: number | null;
  floodlights: boolean | null;
  /** The pitch's own rule; null inherits the venue's (D11). */
  access: AccessClass | null;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  /** Send back as If-Match (it's also the ETag header). */
  version: string;
}

export function toAdminPitchDto(row: unknown): AdminPitchDto {
  const r = adminPitchRow.parse(row);
  return {
    id: r.id,
    venueId: r.venue_id,
    slug: r.slug,
    name: r.name,
    surface: r.surface,
    pitchFormat: r.pitch_format,
    lengthMeters: r.length_m,
    widthMeters: r.width_m,
    floodlights: r.floodlights,
    access: r.access,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
  };
}
