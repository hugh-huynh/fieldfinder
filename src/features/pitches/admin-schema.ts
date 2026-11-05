import { z } from "zod";

import { slugField } from "@/features/venues/admin-schema";
import { ACCESS_CLASSES, PITCH_FORMATS, SURFACES } from "@/lib/domain/enums";

// Admin pitch payloads (PR 2.10). Strict, mirroring the CHECKs in migration 0001. Dimensions are
// numeric(5,1) in the database, so more than one decimal place is rejected rather than silently
// rounded. null clears an attribute ("not confirmed"); access null means "inherits the venue's".

const oneDecimal = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
const metres = (max: number) => z.number().gt(0).max(max).refine(oneDecimal, "at most one decimal place");

export const pitchCreateSchema = z
  .object({
    slug: slugField,
    name: z.string().trim().min(1).max(200),
    surface: z.enum(SURFACES).nullable().optional(),
    pitchFormat: z.enum(PITCH_FORMATS).nullable().optional(),
    lengthMeters: metres(200).nullable().optional(),
    widthMeters: metres(150).nullable().optional(),
    floodlights: z.boolean().nullable().optional(),
    access: z.enum(ACCESS_CLASSES).nullable().optional(),
  })
  .strict();

export const pitchPatchSchema = pitchCreateSchema.partial().strict();

export type PitchCreate = z.output<typeof pitchCreateSchema>;
export type PitchPatch = z.output<typeof pitchPatchSchema>;

/** API field → pitches column. */
export const PITCH_COLUMNS = {
  slug: "slug",
  name: "name",
  surface: "surface",
  pitchFormat: "pitch_format",
  lengthMeters: "length_m",
  widthMeters: "width_m",
  floodlights: "floodlights",
  access: "access",
} as const satisfies Record<keyof PitchCreate, string>;
