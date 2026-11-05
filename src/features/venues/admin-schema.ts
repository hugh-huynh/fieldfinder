import { z } from "zod";

import { ACCESS_CLASSES, AMENITY_KEYS } from "@/lib/domain/enums";

// Admin venue payloads (PR 2.10). Strict: unknown fields are rejected. Limits mirror the CHECKs in
// migration 0001, so a request that passes here doesn't fail in the database. Text is trimmed.
// In a PATCH an absent field is unchanged and null clears an optional one ("not confirmed").

export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;
export const AMENITY_STATES = ["yes", "no", "unknown"] as const;
export type AmenityState = (typeof AMENITY_STATES)[number];

export const slugField = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const text = (max: number) => z.string().trim().min(1).max(max);

const venueFields = {
  slug: slugField,
  name: text(200),
  streetAddress: text(300).nullable(),
  suburb: text(100),
  state: z.enum(AU_STATES),
  postcode: z
    .string()
    .regex(/^[0-9]{4}$/)
    .nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  description: text(5000).nullable(),
  access: z.enum(ACCESS_CLASSES).nullable(),
  amenities: z.partialRecord(z.enum(AMENITY_KEYS), z.enum(AMENITY_STATES)),
};

export const venueCreateSchema = z
  .object({
    slug: venueFields.slug,
    name: venueFields.name,
    streetAddress: venueFields.streetAddress.optional(),
    suburb: venueFields.suburb,
    state: venueFields.state,
    postcode: venueFields.postcode.optional(),
    latitude: venueFields.latitude,
    longitude: venueFields.longitude,
    description: venueFields.description.optional(),
    access: venueFields.access.optional(),
    amenities: venueFields.amenities.optional(),
  })
  .strict();

export const venuePatchSchema = venueCreateSchema.partial().strict();

export type VenueCreate = z.output<typeof venueCreateSchema>;
export type VenuePatch = z.output<typeof venuePatchSchema>;

/** API field → venues column, for the fields stored on the venue row itself. */
export const VENUE_COLUMNS = {
  slug: "slug",
  name: "name",
  streetAddress: "street_address",
  suburb: "suburb",
  state: "state",
  postcode: "postcode",
  latitude: "latitude",
  longitude: "longitude",
  description: "description",
  access: "access",
} as const satisfies Partial<Record<keyof VenueCreate, string>>;
