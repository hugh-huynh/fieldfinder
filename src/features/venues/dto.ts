import { z } from "zod";

import { dbNumber, dbTimestamp } from "@/lib/db/row-types";
import { ACCESS_CLASSES, AMENITY_KEYS, type AccessClass, type AmenityKey } from "@/lib/domain/enums";

import { venueRouteTarget } from "./route-target";

// Public venue and media DTOs (CLAUDE.md rule 3). Each mapper validates the row, then builds the DTO
// field by field: that construction IS the allowlist, so a column added to a view can never reach a
// client until it is added here deliberately. NULL means "not confirmed" and stays null.

// ---------------------------------------------------------------------------
// Search results: one row of search_venues()
// ---------------------------------------------------------------------------

const venueSearchRow = z.object({
  venue_id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  suburb: z.string(),
  state: z.string(),
  latitude: dbNumber,
  longitude: dbNumber,
  access: z.enum(ACCESS_CLASSES).nullable(),
  distance_m: dbNumber,
  published_pitch_count: dbNumber,
  matching_pitch_count: dbNumber,
  single_pitch_slug: z.string().nullable(),
});

export interface VenueSummaryDto {
  id: string;
  slug: string;
  name: string;
  suburb: string;
  state: string;
  /** Public venue location (not the user's). */
  location: { latitude: number; longitude: number };
  access: AccessClass | null;
  /** From the rounded search centre (ADR-0005); the UI may recompute from the user's precise fix. */
  distanceMeters: number;
  publishedPitchCount: number;
  matchingPitchCount: number;
  /** Page the card and marker preview link to: the pitch page for a single-pitch venue (spec §2). */
  href: string;
}

export function toVenueSummaryDto(row: unknown): VenueSummaryDto {
  const r = venueSearchRow.parse(row);
  return {
    id: r.venue_id,
    slug: r.slug,
    name: r.name,
    suburb: r.suburb,
    state: r.state,
    location: { latitude: r.latitude, longitude: r.longitude },
    access: r.access,
    distanceMeters: Math.round(r.distance_m),
    publishedPitchCount: r.published_pitch_count,
    matchingPitchCount: r.matching_pitch_count,
    // search_venues() returns the slug only when the venue has exactly one published pitch.
    href: venueRouteTarget(r.slug, r.single_pitch_slug === null ? [] : [r.single_pitch_slug]),
  };
}

// ---------------------------------------------------------------------------
// Venue details: one row of public_venues_v
// ---------------------------------------------------------------------------

const publicVenueRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  street_address: z.string().nullable(),
  suburb: z.string(),
  state: z.string(),
  postcode: z.string().nullable(),
  latitude: dbNumber,
  longitude: dbNumber,
  description: z.string().nullable(),
  access: z.enum(ACCESS_CLASSES).nullable(),
  published_pitch_count: dbNumber,
  amenities: z.record(z.string(), z.unknown()),
  updated_at: dbTimestamp,
});

/** Confirmed amenities only. A missing key means "not confirmed", never "no". */
export type AmenitiesDto = Partial<Record<AmenityKey, "yes" | "no">>;

export interface VenueDetailDto {
  id: string;
  slug: string;
  name: string;
  streetAddress: string | null;
  suburb: string;
  state: string;
  postcode: string | null;
  location: { latitude: number; longitude: number };
  description: string | null;
  access: AccessClass | null;
  publishedPitchCount: number;
  amenities: AmenitiesDto;
  updatedAt: string;
}

/** Keeps known amenity keys with a confirmed yes/no, in a stable order. */
export function toAmenitiesDto(raw: Record<string, unknown>): AmenitiesDto {
  const out: AmenitiesDto = {};
  for (const key of AMENITY_KEYS) {
    const state = raw[key];
    if (state === "yes" || state === "no") out[key] = state;
  }
  return out;
}

export function toVenueDetailDto(row: unknown): VenueDetailDto {
  const r = publicVenueRow.parse(row);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    streetAddress: r.street_address,
    suburb: r.suburb,
    state: r.state,
    postcode: r.postcode,
    location: { latitude: r.latitude, longitude: r.longitude },
    description: r.description,
    access: r.access,
    publishedPitchCount: r.published_pitch_count,
    amenities: toAmenitiesDto(r.amenities),
    updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Media: one row of public_media_v
// ---------------------------------------------------------------------------

const publicMediaRow = z.object({
  id: z.uuid(),
  venue_id: z.uuid().nullable(),
  pitch_id: z.uuid().nullable(),
  public_key: z.string().min(1),
  content_type: z.enum(["image/webp", "image/avif"]),
  width_px: dbNumber,
  height_px: dbNumber,
  alt_text: z.string(),
  display_order: dbNumber,
  author: z.string().nullable(),
  source_url: z.string().nullable(),
  license_name: z.string().nullable(),
  license_url: z.string().nullable(),
  attribution_text: z.string().nullable(),
});

export interface AttributionDto {
  text: string;
  author: string | null;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
}

export interface MediaDto {
  id: string;
  url: string;
  contentType: "image/webp" | "image/avif";
  width: number;
  height: number;
  alt: string;
  displayOrder: number;
  /** Shown wherever the licence requires it (ADR-0006); null for owned images. */
  attribution: AttributionDto | null;
}

/** `publicUrl` turns a public object key into a URL (the storage base URL arrives with PR 2.12). */
export function toMediaDto(row: unknown, publicUrl: (publicKey: string) => string): MediaDto {
  const r = publicMediaRow.parse(row);
  return {
    id: r.id,
    url: publicUrl(r.public_key),
    contentType: r.content_type,
    width: r.width_px,
    height: r.height_px,
    alt: r.alt_text,
    displayOrder: r.display_order,
    attribution:
      r.attribution_text === null
        ? null
        : {
            text: r.attribution_text,
            author: r.author,
            sourceUrl: r.source_url,
            licenseName: r.license_name,
            licenseUrl: r.license_url,
          },
  };
}
