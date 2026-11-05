import { z } from "zod";

import { dbNumber, dbTimestamp } from "@/lib/db/row-types";
import { ACCESS_CLASSES, AMENITY_KEYS, type AccessClass, type AmenityKey } from "@/lib/domain/enums";

import { AMENITY_STATES, AU_STATES, type AmenityState } from "./admin-schema";

// Admin venue DTO (PR 2.10): what authenticated admin routes return. Unlike the public DTOs it
// includes drafts, status and every amenity state, but it's still built field by field from an
// explicit row shape (CLAUDE.md rule 3), never by passing a row through.

const adminVenueRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  street_address: z.string().nullable(),
  suburb: z.string(),
  state: z.enum(AU_STATES),
  postcode: z.string().nullable(),
  latitude: dbNumber,
  longitude: dbNumber,
  description: z.string().nullable(),
  access: z.enum(ACCESS_CLASSES).nullable(),
  status: z.enum(["draft", "published", "archived"]),
  amenities: z.record(z.string(), z.enum(AMENITY_STATES)),
  created_at: dbTimestamp,
  updated_at: dbTimestamp,
  version: z.string().regex(/^\d+$/),
});

export interface AdminVenueDto {
  id: string;
  slug: string;
  name: string;
  streetAddress: string | null;
  suburb: string;
  state: (typeof AU_STATES)[number];
  postcode: string | null;
  latitude: number;
  longitude: number;
  description: string | null;
  access: AccessClass | null;
  status: "draft" | "published" | "archived";
  /** Every amenity; one never recorded is "unknown". */
  amenities: Record<AmenityKey, AmenityState>;
  createdAt: string;
  updatedAt: string;
  /** Send back as If-Match (it's also the ETag header). */
  version: string;
}

export function toAdminVenueDto(row: unknown): AdminVenueDto {
  const r = adminVenueRow.parse(row);
  const amenities = Object.fromEntries(AMENITY_KEYS.map((key) => [key, r.amenities[key] ?? "unknown"])) as Record<
    AmenityKey,
    AmenityState
  >;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    streetAddress: r.street_address,
    suburb: r.suburb,
    state: r.state,
    postcode: r.postcode,
    latitude: r.latitude,
    longitude: r.longitude,
    description: r.description,
    access: r.access,
    status: r.status,
    amenities,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
  };
}
