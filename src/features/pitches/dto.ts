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

// Public pitch DTO (CLAUDE.md rule 3): built field by field from one row of public_pitches_v.
// NULL attributes mean "not confirmed" and stay null; the UI renders them as such.

const publicPitchRow = z.object({
  id: z.uuid(),
  venue_id: z.uuid(),
  venue_slug: z.string(),
  slug: z.string(),
  name: z.string(),
  surface: z.enum(SURFACES).nullable(),
  pitch_format: z.enum(PITCH_FORMATS).nullable(),
  length_m: dbNumber.nullable(),
  width_m: dbNumber.nullable(),
  floodlights: z.boolean().nullable(),
  access: z.enum(ACCESS_CLASSES).nullable(),
  effective_access: z.enum(ACCESS_CLASSES).nullable(),
  updated_at: dbTimestamp,
});

export interface PitchDto {
  id: string;
  venueId: string;
  venueSlug: string;
  slug: string;
  name: string;
  surface: Surface | null;
  pitchFormat: PitchFormat | null;
  lengthMeters: number | null;
  widthMeters: number | null;
  floodlights: boolean | null;
  /** The pitch's own rule; null means it inherits the venue's (D11). */
  access: AccessClass | null;
  /** COALESCE(pitch, venue): what filters and the UI should use. */
  effectiveAccess: AccessClass | null;
  updatedAt: string;
}

export function toPitchDto(row: unknown): PitchDto {
  const r = publicPitchRow.parse(row);
  return {
    id: r.id,
    venueId: r.venue_id,
    venueSlug: r.venue_slug,
    slug: r.slug,
    name: r.name,
    surface: r.surface,
    pitchFormat: r.pitch_format,
    lengthMeters: r.length_m,
    widthMeters: r.width_m,
    floodlights: r.floodlights,
    access: r.access,
    effectiveAccess: r.effective_access,
    updatedAt: r.updated_at,
  };
}
