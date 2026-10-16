// Public enum values, mirroring the database enums (supabase/migrations/0001_core.sql).
// A unit test checks these lists against the migration so they can't drift.

export const SURFACES = ["grass", "synthetic", "hybrid"] as const;
export type Surface = (typeof SURFACES)[number];

export const PITCH_FORMATS = ["full", "small_sided", "training"] as const;
export type PitchFormat = (typeof PITCH_FORMATS)[number];

export const ACCESS_CLASSES = ["public", "booking_required", "members_only"] as const;
export type AccessClass = (typeof ACCESS_CLASSES)[number];

export const AMENITY_KEYS = [
  "parking",
  "toilets",
  "changing_rooms",
  "drinking_water",
  "cafe",
  "public_transport",
] as const;
export type AmenityKey = (typeof AMENITY_KEYS)[number];
