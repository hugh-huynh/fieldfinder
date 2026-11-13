import "server-only";

import { z } from "zod";

import type { MediaDto, VenueDetailDto, VenueSummaryDto } from "@/features/venues/dto";
import { UNUSED_REASONS, type AdminMediaDto } from "@/features/media/admin-dto";
import type { UnusedMediaPage } from "@/features/media/admin-service";
import { RIGHTS_BASES } from "@/features/media/admin-schema";
import type { AdminPitchDto } from "@/features/pitches/admin-dto";
import type { PitchDto } from "@/features/pitches/dto";
import type { LocationSuggestionDto, SuggestResponse } from "@/features/locations/suggest";
import type { VenueSearchResponse, VenueSearchResultDto } from "@/features/search/search";
import type { AdminVenueDto } from "@/features/venues/admin-dto";
import { AMENITY_STATES, AU_STATES } from "@/features/venues/admin-schema";
import type { VenueTransitionResult } from "@/features/venues/admin-publish";
import type { AdminVerificationDto } from "@/features/venues/admin-verification";
import type { PitchDetailResponse, VenueDetailResponse } from "@/features/venues/detail";
import { API_ERRORS, type ApiErrorBody } from "@/lib/api/errors";
import { ACCESS_CLASSES, AMENITY_KEYS, PITCH_FORMATS, SURFACES } from "@/lib/domain/enums";

// Response schemas for the OpenAPI document (PR 2.14, D22). The DTOs are TypeScript interfaces built
// field by field by their mappers (CLAUDE.md rule 3), so these Zod schemas describe them for the
// docs only; nothing parses a response with them. The `Same<…>` checks at the bottom make
// `pnpm typecheck` fail if a schema and its DTO ever disagree, so the document can't drift from
// what the routes really return.

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true }).meta({ example: "2026-11-01T09:30:00.000Z" });
const version = z
  .string()
  .regex(/^\d{1,20}$/)
  .meta({
    description: "updated_at in microseconds. Also the ETag; send it back as If-Match.",
    example: "1761987000000000",
  });
const status = z.enum(["draft", "published", "archived"]);
const location = z.object({ latitude: z.number(), longitude: z.number() });

export const errorSchema = z
  .object({
    code: z.enum(Object.keys(API_ERRORS) as [keyof typeof API_ERRORS, ...(keyof typeof API_ERRORS)[]]),
    message: z.string().meta({ description: "Safe to show to anyone. Never a stack trace or field value." }),
    requestId: z.string().meta({ description: "Also in the X-Request-Id header. Quote it when reporting a problem." }),
  })
  .meta({ id: "Error" });

// --- Public ------------------------------------------------------------------------------------

const amenities = z
  .partialRecord(z.enum(AMENITY_KEYS), z.enum(["yes", "no"]))
  .meta({ id: "Amenities", description: 'Confirmed amenities only. A missing key means "not confirmed", never "no".' });

const attribution = z.object({
  text: z.string(),
  author: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  licenseName: z.string().nullable(),
  licenseUrl: z.string().nullable(),
});

export const mediaSchema = z
  .object({
    id: uuid,
    url: z.string().meta({ description: "Public image URL. Stops working once the image is unpublished." }),
    contentType: z.enum(["image/webp", "image/avif"]),
    width: z.number().int(),
    height: z.number().int(),
    alt: z.string(),
    displayOrder: z.number().int(),
    attribution: attribution
      .nullable()
      .meta({ description: "Show it wherever the image is shown. Null for images FieldFinder owns." }),
  })
  .meta({ id: "Media" });

const venueSummaryShape = {
  id: uuid,
  slug: z.string(),
  name: z.string(),
  suburb: z.string(),
  state: z.string(),
  location: location.meta({ description: "The venue's public location, never the searcher's." }),
  access: z.enum(ACCESS_CLASSES).nullable(),
  distanceMeters: z.number().int().meta({ description: "From the rounded search centre." }),
  publishedPitchCount: z.number().int(),
  matchingPitchCount: z.number().int().meta({ description: "Pitches that match every pitch filter on their own." }),
  href: z.string().meta({
    description: "Page to open: the pitch page when the venue has one published pitch, else the venue page.",
    example: "/venues/wattlebird-reserve",
  }),
};

const venueSearchResult = z
  .object({ ...venueSummaryShape, amenities, image: mediaSchema.nullable() })
  .meta({ id: "VenueSearchResult" });

export const venueSearchResponseSchema = z
  .object({
    items: z.array(venueSearchResult),
    totalCount: z.number().int().meta({ description: "Venues matching the search across all pages." }),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: "Pass back as `cursor` for the next page. Null on the last page." }),
  })
  .meta({ id: "VenueSearchResponse" });

const venueDetail = z
  .object({
    id: uuid,
    slug: z.string(),
    name: z.string(),
    streetAddress: z.string().nullable(),
    suburb: z.string(),
    state: z.string(),
    postcode: z.string().nullable(),
    location,
    description: z.string().nullable(),
    access: z.enum(ACCESS_CLASSES).nullable(),
    publishedPitchCount: z.number().int(),
    amenities,
    updatedAt: timestamp,
  })
  .meta({ id: "VenueDetail" });

const pitch = z
  .object({
    id: uuid,
    venueId: uuid,
    venueSlug: z.string(),
    slug: z.string(),
    name: z.string(),
    surface: z.enum(SURFACES).nullable(),
    pitchFormat: z.enum(PITCH_FORMATS).nullable(),
    lengthMeters: z.number().nullable(),
    widthMeters: z.number().nullable(),
    floodlights: z.boolean().nullable(),
    access: z
      .enum(ACCESS_CLASSES)
      .nullable()
      .meta({ description: "The pitch's own rule. Null means it uses the venue's." }),
    effectiveAccess: z
      .enum(ACCESS_CLASSES)
      .nullable()
      .meta({ description: "The rule that applies: the pitch's, else the venue's." }),
    updatedAt: timestamp,
  })
  .meta({ id: "Pitch", description: 'Null attributes are "not confirmed".' });

export const venueDetailResponseSchema = z
  .object({ venue: venueDetail, pitches: z.array(pitch), media: z.array(mediaSchema) })
  .meta({ id: "VenueDetailResponse" });

export const pitchDetailResponseSchema = z
  .object({
    pitch,
    venue: venueDetail,
    media: z.array(mediaSchema),
    venueMedia: z.array(mediaSchema),
  })
  .meta({ id: "PitchDetailResponse" });

const locationSuggestion = z
  .object({
    id: z.string(),
    name: z.string(),
    label: z.string(),
    type: z.enum(["postcode", "place", "locality", "neighborhood", "address"]),
    latitude: z.number().meta({ description: "Rounded to 3 decimal places." }),
    longitude: z.number().meta({ description: "Rounded to 3 decimal places." }),
  })
  .meta({ id: "LocationSuggestion" });

export const suggestResponseSchema = z
  .object({ suggestions: z.array(locationSuggestion).max(5) })
  .meta({ id: "SuggestResponse" });

// --- Admin -------------------------------------------------------------------------------------

const adminVenue = z
  .object({
    id: uuid,
    slug: z.string(),
    name: z.string(),
    streetAddress: z.string().nullable(),
    suburb: z.string(),
    state: z.enum(AU_STATES),
    postcode: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
    description: z.string().nullable(),
    access: z.enum(ACCESS_CLASSES).nullable(),
    status,
    amenities: z
      .record(z.enum(AMENITY_KEYS), z.enum(AMENITY_STATES))
      .meta({ description: 'Every amenity; one never recorded is "unknown".' }),
    createdAt: timestamp,
    updatedAt: timestamp,
    version,
  })
  .meta({ id: "AdminVenue" });

const adminPitch = z
  .object({
    id: uuid,
    venueId: uuid,
    slug: z.string(),
    name: z.string(),
    surface: z.enum(SURFACES).nullable(),
    pitchFormat: z.enum(PITCH_FORMATS).nullable(),
    lengthMeters: z.number().nullable(),
    widthMeters: z.number().nullable(),
    floodlights: z.boolean().nullable(),
    access: z.enum(ACCESS_CLASSES).nullable(),
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    version,
  })
  .meta({ id: "AdminPitch" });

const adminMedia = z
  .object({
    id: uuid,
    venueId: uuid.nullable(),
    pitchId: uuid.nullable(),
    contentType: z.enum(["image/webp", "image/avif"]),
    width: z.number().int(),
    height: z.number().int(),
    byteSize: z.number().int(),
    alt: z.string(),
    displayOrder: z.number().int(),
    status,
    publicUrl: z.string().nullable().meta({ description: "Set only while published." }),
    rights: z.object({
      basis: z.enum(RIGHTS_BASES).nullable(),
      author: z.string().nullable(),
      sourceUrl: z.string().nullable(),
      licenseName: z.string().nullable(),
      licenseUrl: z.string().nullable(),
      attributionText: z.string().nullable(),
      evidenceRef: z.string().nullable(),
      commercialUseOk: z.boolean().nullable(),
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
    version,
    unused: z.boolean().meta({ description: "True when the image isn't shown anywhere public." }),
    unusedReason: z.enum(UNUSED_REASONS).nullable().meta({
      description:
        "Why it's unused, owner first: owner_archived, owner_draft, owner_not_public (venue published without a published pitch), image_archived, image_draft. Null when in use.",
    }),
  })
  .meta({ id: "AdminMedia" });

const adminVerification = z
  .object({
    id: uuid,
    venueId: uuid,
    sourceId: uuid.nullable(),
    verifiedBy: z.string(),
    verifiedOn: z.iso.date(),
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z.string().nullable(),
    internalNotes: z.string().nullable(),
    createdAt: timestamp,
  })
  .meta({ id: "AdminVerification" });

export const adminVenueResponseSchema = z.object({ venue: adminVenue }).meta({ id: "AdminVenueResponse" });
export const adminPitchResponseSchema = z.object({ pitch: adminPitch }).meta({ id: "AdminPitchResponse" });
export const adminMediaResponseSchema = z.object({ media: adminMedia }).meta({ id: "AdminMediaResponse" });
export const adminMediaListResponseSchema = z
  .object({
    items: z.array(adminMedia),
    nextCursor: z
      .uuid()
      .nullable()
      .meta({ description: "Pass back as `cursor` for the next page. Null on the last page." }),
  })
  .meta({ id: "AdminMediaListResponse" });
export const adminVerificationResponseSchema = z
  .object({ verification: adminVerification })
  .meta({ id: "AdminVerificationResponse" });
export const venueTransitionResponseSchema = z
  .object({
    venue: adminVenue,
    pitches: z.array(adminPitch).meta({ description: "All of the venue's pitches after the change." }),
  })
  .meta({ id: "VenueTransitionResponse" });

// --- Drift checks: each schema must describe exactly its DTO ------------------------------------

/**
 * True only when A and B are assignable both ways: a missing, extra, optional or nullable field on
 * either side makes it false. (Tuples stop `boolean`-style unions distributing.)
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Check<T extends true> = T;
type Shape<S extends z.ZodType> = z.output<S>;

export type DriftChecks = [
  Check<Same<Shape<typeof errorSchema>, ApiErrorBody>>,
  Check<Same<Shape<typeof mediaSchema>, MediaDto>>,
  Check<Same<Omit<Shape<typeof venueSearchResult>, "amenities" | "image">, VenueSummaryDto>>,
  Check<Same<Shape<typeof venueSearchResult>, VenueSearchResultDto>>,
  Check<Same<Shape<typeof venueSearchResponseSchema>, VenueSearchResponse>>,
  Check<Same<Shape<typeof venueDetail>, VenueDetailDto>>,
  Check<Same<Shape<typeof pitch>, PitchDto>>,
  Check<Same<Shape<typeof venueDetailResponseSchema>, VenueDetailResponse>>,
  Check<Same<Shape<typeof pitchDetailResponseSchema>, PitchDetailResponse>>,
  Check<Same<Shape<typeof locationSuggestion>, LocationSuggestionDto>>,
  Check<Same<Shape<typeof suggestResponseSchema>, SuggestResponse>>,
  Check<Same<Shape<typeof adminVenue>, AdminVenueDto>>,
  Check<Same<Shape<typeof adminPitch>, AdminPitchDto>>,
  Check<Same<Shape<typeof adminMedia>, AdminMediaDto>>,
  Check<Same<Shape<typeof adminMediaListResponseSchema>, UnusedMediaPage>>,
  Check<Same<Shape<typeof adminVerification>, AdminVerificationDto>>,
  Check<Same<Shape<typeof venueTransitionResponseSchema>, VenueTransitionResult>>,
];
