import "server-only";

import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import { suggestQuerySchema } from "@/features/locations/suggest";
import { mediaPatchSchema, mediaUploadSchema } from "@/features/media/admin-schema";
import type { AdminPitchDto } from "@/features/pitches/admin-dto";
import { pitchCreateSchema, pitchPatchSchema } from "@/features/pitches/admin-schema";
import type { PitchDto } from "@/features/pitches/dto";
import { searchQuerySchema } from "@/features/search/query";
import { transitionSchema, venuePublishSchema } from "@/features/venues/admin-publish";
import type { AdminVenueDto } from "@/features/venues/admin-dto";
import { venueCreateSchema, venuePatchSchema } from "@/features/venues/admin-schema";
import { verificationCreateSchema } from "@/features/venues/admin-verification";
import type { MediaDto, VenueDetailDto } from "@/features/venues/dto";
import { slugSchema } from "@/features/venues/slug";
import { API_ERRORS, type ApiErrorCode } from "@/lib/api/errors";
import { MAX_JSON_BODY_BYTES } from "@/lib/api/body";
import type { AdminScope } from "@/lib/auth/scopes";
import { MAX_UPLOAD_BYTES } from "@/lib/media/image";

import {
  adminMediaResponseSchema,
  adminPitchResponseSchema,
  adminVenueResponseSchema,
  adminVerificationResponseSchema,
  errorSchema,
  pitchDetailResponseSchema,
  suggestResponseSchema,
  venueDetailResponseSchema,
  venueSearchResponseSchema,
  venueTransitionResponseSchema,
} from "./responses";

// The API contract (spec §5, D22, PR 2.14), built from the same Zod schemas the routes validate with.
// `pnpm openapi:generate` writes it to docs/api/openapi.json; src/lib/openapi/document.test.ts fails
// when the committed file is out of date or a route under src/app/api isn't documented here.
//
// Request schemas with transforms (e.g. `lat`, a decimal string turned into a rounded number) are
// documented by their input, which is what a client sends.

const SERVER_URL = "https://fieldfinder.example";

/** A JSON body. An example must pass its schema, so the docs can't show a request the API rejects. */
function json<S extends z.ZodType>(schema: S, example?: z.input<S>) {
  if (example !== undefined) schema.parse(example);
  return { "application/json": example === undefined ? { schema } : { schema, example } };
}

const ERROR_TEXT: Record<ApiErrorCode, string> = {
  invalid_request: "Invalid request: a parameter, header or body field failed validation.",
  unauthenticated: "Missing, malformed, expired or revoked admin token.",
  forbidden: "The token is valid but lacks the scope this route needs, or the client IP isn't on its allowlist.",
  not_found: "Not found. Public routes also say this for anything that isn't published.",
  conflict: "If-Match is stale, or the change isn't allowed in the record's current state.",
  idempotency_mismatch: "This Idempotency-Key was already used with a different request.",
  rate_limited: "Too many requests. Wait for Retry-After seconds, when given.",
  internal: "Unexpected server error. Quote the requestId.",
  unavailable: "A dependency (database, storage or Mapbox) isn't available. Retry later.",
};

const STATUS: Record<ApiErrorCode, string> = {
  invalid_request: "400",
  unauthenticated: "401",
  forbidden: "403",
  not_found: "404",
  conflict: "409",
  idempotency_mismatch: "422",
  rate_limited: "429",
  internal: "500",
  unavailable: "503",
};

/** Component name for each error response, e.g. "InvalidRequest". */
const responseName = (code: ApiErrorCode) =>
  code.replace(/(^|_)([a-z])/g, (_match, _sep: string, letter: string) => letter.toUpperCase());

/** Each error is described once under components/responses; operations reference it. */
function registerErrorResponses(registry: OpenAPIRegistry): void {
  for (const code of Object.keys(ERROR_TEXT) as ApiErrorCode[]) {
    registry.registerComponent("responses", responseName(code), {
      description: ERROR_TEXT[code],
      ...(code === "rate_limited" && {
        headers: {
          "Retry-After": {
            description: "Seconds to wait. Sent by the admin limiter; the edge limiter may omit it.",
            schema: { type: "string" },
          },
        },
      }),
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: { code, message: API_ERRORS[code].message, requestId: "0b7e7c38-4d1f-4a8e-9b52-2f1d3c4e5a6b" },
        },
      },
    });
  }
}

function errors(...codes: ApiErrorCode[]): Record<string, { $ref: string }> {
  return Object.fromEntries(
    codes.map((code) => [STATUS[code], { $ref: `#/components/responses/${responseName(code)}` }]),
  );
}

const PUBLIC_ERRORS = errors("invalid_request", "rate_limited", "internal", "unavailable");
const ADMIN_ERRORS = errors("invalid_request", "unauthenticated", "forbidden", "rate_limited", "internal");

const etagHeader = z.object({
  ETag: z.string().meta({ description: 'The record\'s version, e.g. "1761987000000000". Send it as If-Match.' }),
});
const replayHeader = z.object({
  "Idempotent-Replayed": z
    .literal("true")
    .optional()
    .meta({ description: "Present when this is the stored response to an earlier request with the same key." }),
});

const ifMatch = z
  .string()
  .regex(/^"\d{1,20}"$/)
  .meta({ description: "The ETag from your last read of this record.", example: '"1761987000000000"' });
const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,128}$/)
  .optional()
  .meta({
    description: "Optional. A retry with the same key and request returns the stored response for 24 h.",
    example: "import-2026-11-11-venue-0001",
  });

const createHeaders = z.object({ "Idempotency-Key": idempotencyKey });
const changeHeaders = z.object({ "If-Match": ifMatch, "Idempotency-Key": idempotencyKey });

const idParams = z.object({ id: z.uuid().meta({ example: "5eed0000-0000-4000-8000-000000000001" }) });

// Fake data only (spec §5: "sample requests/responses with fake data").
const exampleMedia: MediaDto = {
  id: "5eed0000-0000-4000-8000-0000000000a1",
  url: "https://media.fieldfinder.example/storage/v1/object/public/media-public/Zm9vYmFyYmF6cXV4.webp",
  contentType: "image/webp",
  width: 1600,
  height: 1067,
  alt: "Main pitch at Wattlebird Reserve, looking north",
  displayOrder: 0,
  attribution: null,
};
const exampleVenueDetail: VenueDetailDto = {
  id: "5eed0000-0000-4000-8000-000000000001",
  slug: "wattlebird-reserve",
  name: "Wattlebird Reserve",
  streetAddress: "1 Example Road",
  suburb: "Brunswick",
  state: "VIC",
  postcode: "3056",
  location: { latitude: -37.767, longitude: 144.96 },
  description: null,
  access: "public",
  publishedPitchCount: 2,
  amenities: { parking: "yes", toilets: "yes", cafe: "no" },
  updatedAt: "2026-11-01T09:30:00.000Z",
};
const examplePitch: PitchDto = {
  id: "5eed0000-0000-4000-8000-000000000101",
  venueId: exampleVenueDetail.id,
  venueSlug: exampleVenueDetail.slug,
  slug: "north-pitch",
  name: "North Pitch",
  surface: "grass",
  pitchFormat: "full",
  lengthMeters: 100,
  widthMeters: 64,
  floodlights: null,
  access: null,
  effectiveAccess: "public",
  updatedAt: "2026-11-01T09:30:00.000Z",
};
const exampleAdminVenue: AdminVenueDto = {
  id: exampleVenueDetail.id,
  slug: exampleVenueDetail.slug,
  name: exampleVenueDetail.name,
  streetAddress: exampleVenueDetail.streetAddress,
  suburb: exampleVenueDetail.suburb,
  state: "VIC",
  postcode: exampleVenueDetail.postcode,
  latitude: -37.7671,
  longitude: 144.9602,
  description: null,
  access: "public",
  status: "draft",
  amenities: {
    parking: "yes",
    toilets: "yes",
    changing_rooms: "unknown",
    drinking_water: "unknown",
    cafe: "no",
    public_transport: "unknown",
  },
  createdAt: "2026-11-01T09:30:00.000Z",
  updatedAt: "2026-11-01T09:30:00.000Z",
  version: "1761989400000000",
};
const exampleAdminPitch: AdminPitchDto = {
  id: examplePitch.id,
  venueId: examplePitch.venueId,
  slug: examplePitch.slug,
  name: examplePitch.name,
  surface: "grass",
  pitchFormat: "full",
  lengthMeters: 100,
  widthMeters: 64,
  floodlights: null,
  access: null,
  status: "draft",
  createdAt: "2026-11-01T09:31:00.000Z",
  updatedAt: "2026-11-01T09:31:00.000Z",
  version: "1761989460000000",
};

type PathConfig = Parameters<OpenAPIRegistry["registerPath"]>[0];

function admin(scope: AdminScope, config: PathConfig): PathConfig {
  return {
    ...config,
    tags: ["Admin"],
    security: [{ adminToken: [] }],
    description: `${config.description ?? ""}\n\nScope: \`${scope}\`.`.trim(),
  };
}

function transition(path: string, summary: string, description: string, entity: "venue" | "pitch" | "media") {
  const response =
    entity === "venue"
      ? venueTransitionResponseSchema
      : entity === "pitch"
        ? adminPitchResponseSchema
        : adminMediaResponseSchema;
  return admin("content:publish", {
    method: "post",
    path,
    operationId: `${entity}.${summary.split(" ")[0]?.toLowerCase() ?? "transition"}`,
    summary,
    description,
    request: {
      params: idParams,
      headers: changeHeaders,
      body: { required: false, content: json(transitionSchema, { reason: "Checked on site 2026-11-01" }) },
    },
    responses: {
      200: {
        description: "Done. ETag is the record's new version.",
        headers: etagHeader.extend(replayHeader.shape),
        content: json(response),
      },
      ...ADMIN_ERRORS,
      ...errors("not_found", "conflict", "idempotency_mismatch"),
    },
  });
}

/** Every documented operation, as "METHOD /path" with {param} placeholders. */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registerErrorResponses(registry);
  registry.registerComponent("securitySchemes", "adminToken", {
    type: "http",
    scheme: "bearer",
    description:
      "An `ffadm_…` token minted with `pnpm admin:credential mint` (ADR-0003). Header only: a token in the query string is rejected.",
  });

  // --- Public ----------------------------------------------------------------------------------

  registry.registerPath({
    method: "get",
    path: "/api/venues",
    operationId: "venues.search",
    tags: ["Public"],
    summary: "Search venues near a point",
    description: [
      "Published venues within `radiusKm` of (`lat`, `lng`), nearest first. Pitch filters (`surface`, `pitchSize`,",
      "`lighting`, `access`) must all be met by the same pitch. Coordinates are rounded to 3 decimal places.",
      "Unknown or repeated parameters are a 400. Any non-canonical spelling of a valid query (parameter order,",
      "default values, extra digits) gets a 308 to the canonical URL; clients should request that form directly.",
    ].join(" "),
    request: { query: searchQuerySchema },
    responses: {
      200: {
        description: "One page of results. Cached at the edge for 60 s.",
        content: json(venueSearchResponseSchema, {
          items: [
            {
              id: exampleVenueDetail.id,
              slug: exampleVenueDetail.slug,
              name: exampleVenueDetail.name,
              suburb: "Brunswick",
              state: "VIC",
              location: exampleVenueDetail.location,
              access: "public",
              distanceMeters: 5236,
              publishedPitchCount: 2,
              matchingPitchCount: 1,
              href: "/venues/wattlebird-reserve",
              amenities: exampleVenueDetail.amenities,
              image: exampleMedia,
            },
          ],
          totalCount: 1,
          nextCursor: null,
        }),
      },
      308: {
        description: "Redirect to the canonical form of the same query.",
        headers: z.object({ Location: z.string().meta({ example: "/api/venues?lat=-37.814&lng=144.963" }) }),
      },
      ...PUBLIC_ERRORS,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/venues/{venueSlug}",
    operationId: "venues.detail",
    tags: ["Public"],
    summary: "A published venue with its published pitches and images",
    request: { params: z.object({ venueSlug: slugSchema.meta({ example: "wattlebird-reserve" }) }) },
    responses: {
      200: {
        description: "The venue. Cached at the edge for 60 s.",
        content: json(venueDetailResponseSchema, {
          venue: exampleVenueDetail,
          pitches: [examplePitch],
          media: [exampleMedia],
        }),
      },
      ...PUBLIC_ERRORS,
      ...errors("not_found"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/venues/{venueSlug}/pitches/{pitchSlug}",
    operationId: "pitches.detail",
    tags: ["Public"],
    summary: "A published pitch with its venue's public details",
    request: {
      params: z.object({
        venueSlug: slugSchema.meta({ example: "wattlebird-reserve" }),
        pitchSlug: slugSchema.meta({ example: "north-pitch" }),
      }),
    },
    responses: {
      200: {
        description: "The pitch. Cached at the edge for 60 s.",
        content: json(pitchDetailResponseSchema, {
          pitch: examplePitch,
          venue: exampleVenueDetail,
          media: [],
          venueMedia: [exampleMedia],
        }),
      },
      ...PUBLIC_ERRORS,
      ...errors("not_found"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/locations/suggest",
    operationId: "locations.suggest",
    tags: ["Public"],
    summary: "Place and address suggestions for the search box",
    description:
      "Up to 5 Australian suggestions, biased towards Melbourne (Mapbox Geocoding). Never cached. Pass a suggestion's coordinates to `GET /api/venues`.",
    request: { query: suggestQuerySchema },
    responses: {
      200: {
        description: "Suggestions; possibly none.",
        content: json(suggestResponseSchema, {
          suggestions: [
            {
              id: "dXJuOm1ieHBsYzpFeGFtcGxl",
              name: "Brunswick",
              label: "Brunswick, Victoria 3056, Australia",
              type: "locality",
              latitude: -37.767,
              longitude: 144.96,
            },
          ],
        }),
      },
      ...PUBLIC_ERRORS,
    },
  });

  // --- Admin: venues -----------------------------------------------------------------------------

  registry.registerPath(
    admin("venues:write", {
      method: "post",
      path: "/api/admin/venues",
      operationId: "admin.venues.create",
      summary: "Create a draft venue",
      description: `JSON body, at most ${String(MAX_JSON_BODY_BYTES / 1024)} KB. Omitted optional fields are "not confirmed".`,
      request: {
        headers: createHeaders,
        body: {
          required: true,
          content: json(venueCreateSchema, {
            slug: "wattlebird-reserve",
            name: "Wattlebird Reserve",
            suburb: "Brunswick",
            state: "VIC",
            latitude: -37.7671,
            longitude: 144.9602,
            amenities: { parking: "yes", toilets: "yes" },
          }),
        },
      },
      responses: {
        201: {
          description: "Created as a draft.",
          headers: etagHeader.extend({ Location: z.string() }).extend(replayHeader.shape),
          content: json(adminVenueResponseSchema, { venue: exampleAdminVenue }),
        },
        ...ADMIN_ERRORS,
        ...errors("conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    admin("venues:write", {
      method: "get",
      path: "/api/admin/venues/{id}",
      operationId: "admin.venues.read",
      summary: "Read a venue in any status",
      request: { params: idParams },
      responses: {
        200: { description: "The venue.", headers: etagHeader, content: json(adminVenueResponseSchema) },
        ...ADMIN_ERRORS,
        ...errors("not_found"),
      },
    }),
  );

  registry.registerPath(
    admin("venues:write", {
      method: "patch",
      path: "/api/admin/venues/{id}",
      operationId: "admin.venues.update",
      summary: "Update a venue",
      description:
        'Absent fields are unchanged; null clears an optional field ("not confirmed"). `amenities` merges: each key given is set.',
      request: {
        params: idParams,
        headers: changeHeaders,
        body: { required: true, content: json(venuePatchSchema, { postcode: "3056", amenities: { cafe: "no" } }) },
      },
      responses: {
        200: {
          description: "Updated.",
          headers: etagHeader.extend(replayHeader.shape),
          content: json(adminVenueResponseSchema),
        },
        ...ADMIN_ERRORS,
        ...errors("not_found", "conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    admin("venues:write", {
      method: "post",
      path: "/api/admin/venues/{id}/verifications",
      operationId: "admin.venues.verify",
      summary: "Record a verification of a venue's details",
      description:
        "A venue needs at least one before it can be published. Verifications are internal; no public route returns them.",
      request: {
        params: idParams,
        headers: createHeaders,
        body: {
          required: true,
          content: json(verificationCreateSchema, {
            verifiedBy: "Field team",
            verifiedOn: "2026-11-01",
            confidence: "high",
            evidence: "Site visit, photos in the team drive",
          }),
        },
      },
      responses: {
        201: {
          description: "Recorded.",
          headers: replayHeader,
          content: json(adminVerificationResponseSchema),
        },
        ...ADMIN_ERRORS,
        ...errors("not_found", "conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    admin("content:publish", {
      method: "post",
      path: "/api/admin/venues/{id}/publish",
      operationId: "admin.venues.publish",
      summary: "Publish a venue and the selected pitches",
      description:
        "Needs at least one verification. Each selected pitch must belong to the venue and carry the version you reviewed; a stale one is a 409.",
      request: {
        params: idParams,
        headers: changeHeaders,
        body: {
          required: true,
          content: json(venuePublishSchema, {
            pitches: [{ id: exampleAdminPitch.id, version: exampleAdminPitch.version }],
            reason: "Verified on site",
          }),
        },
      },
      responses: {
        200: {
          description: "Published. ETag is the venue's new version.",
          headers: etagHeader.extend(replayHeader.shape),
          content: json(venueTransitionResponseSchema),
        },
        ...ADMIN_ERRORS,
        ...errors("not_found", "conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    transition(
      "/api/admin/venues/{id}/unpublish",
      "Unpublish a venue",
      "Only the venue goes back to draft. Its pitches keep their status but are hidden while the venue isn't published; pitches that were published become public again when the venue is republished, even if the publish request doesn't list them (unpublish those pitches first to keep them hidden). The public copies of the venue's and its pitches' images are deleted, and the images stay drafts until published again.",
      "venue",
    ),
  );
  registry.registerPath(
    transition(
      "/api/admin/venues/{id}/archive",
      "Archive a venue",
      "Archives the venue and all its pitches. Final: the API can't undo it.",
      "venue",
    ),
  );

  // --- Admin: pitches ----------------------------------------------------------------------------

  registry.registerPath(
    admin("pitches:write", {
      method: "post",
      path: "/api/admin/venues/{id}/pitches",
      operationId: "admin.pitches.create",
      summary: "Create a draft pitch at a venue",
      description: "Dimensions in metres with at most one decimal place. `access: null` uses the venue's rule.",
      request: {
        params: idParams,
        headers: createHeaders,
        body: {
          required: true,
          content: json(pitchCreateSchema, {
            slug: "north-pitch",
            name: "North Pitch",
            surface: "grass",
            pitchFormat: "full",
            lengthMeters: 100,
            widthMeters: 64,
          }),
        },
      },
      responses: {
        201: {
          description: "Created as a draft.",
          headers: etagHeader.extend({ Location: z.string() }).extend(replayHeader.shape),
          content: json(adminPitchResponseSchema, { pitch: exampleAdminPitch }),
        },
        ...ADMIN_ERRORS,
        ...errors("not_found", "conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    admin("pitches:write", {
      method: "get",
      path: "/api/admin/pitches/{id}",
      operationId: "admin.pitches.read",
      summary: "Read a pitch in any status",
      request: { params: idParams },
      responses: {
        200: { description: "The pitch.", headers: etagHeader, content: json(adminPitchResponseSchema) },
        ...ADMIN_ERRORS,
        ...errors("not_found"),
      },
    }),
  );

  registry.registerPath(
    admin("pitches:write", {
      method: "patch",
      path: "/api/admin/pitches/{id}",
      operationId: "admin.pitches.update",
      summary: "Update a pitch",
      description: 'Absent fields are unchanged; null clears one ("not confirmed").',
      request: {
        params: idParams,
        headers: changeHeaders,
        body: { required: true, content: json(pitchPatchSchema, { floodlights: true }) },
      },
      responses: {
        200: {
          description: "Updated.",
          headers: etagHeader.extend(replayHeader.shape),
          content: json(adminPitchResponseSchema),
        },
        ...ADMIN_ERRORS,
        ...errors("not_found", "conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    transition(
      "/api/admin/pitches/{id}/publish",
      "Publish a pitch",
      "Publishes one more pitch of a venue that is already published (publish the venue first otherwise).",
      "pitch",
    ),
  );
  registry.registerPath(
    transition(
      "/api/admin/pitches/{id}/unpublish",
      "Unpublish a pitch",
      "Back to draft; its public image copies are deleted. If it was the venue's last published pitch, the venue disappears from public search and pages until another is published.",
      "pitch",
    ),
  );
  registry.registerPath(
    transition("/api/admin/pitches/{id}/archive", "Archive a pitch", "Final: the API can't undo it.", "pitch"),
  );

  // --- Admin: media ------------------------------------------------------------------------------

  const uploadForm = z
    .object({
      file: z.string().meta({
        format: "binary",
        description: `JPEG, PNG, WebP or AVIF, at most ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Re-encoded to WebP with all metadata removed.`,
      }),
      ...mediaUploadSchema.shape,
    })
    .meta({
      description:
        'Multipart text fields: give exactly one of `venueId` or `pitchId`. `displayOrder` is a whole number, `commercialUseOk` is "true" or "false", and an empty field means null.',
    });

  registry.registerPath(
    admin("media:write", {
      method: "post",
      path: "/api/admin/media",
      operationId: "admin.media.upload",
      summary: "Upload an image for a venue or pitch",
      description: "Stored privately as a draft. Publishing needs complete rights (ADR-0006).",
      request: {
        headers: createHeaders,
        body: { required: true, content: { "multipart/form-data": { schema: uploadForm } } },
      },
      responses: {
        201: {
          description: "Stored as a draft with no public URL.",
          headers: etagHeader.extend({ Location: z.string() }).extend(replayHeader.shape),
          content: json(adminMediaResponseSchema),
        },
        ...ADMIN_ERRORS,
        ...errors("not_found", "conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    admin("media:write", {
      method: "get",
      path: "/api/admin/media/{id}",
      operationId: "admin.media.read",
      summary: "Read an image's record in any status",
      request: { params: idParams },
      responses: {
        200: { description: "The image record.", headers: etagHeader, content: json(adminMediaResponseSchema) },
        ...ADMIN_ERRORS,
        ...errors("not_found"),
      },
    }),
  );

  registry.registerPath(
    admin("media:write", {
      method: "patch",
      path: "/api/admin/media/{id}",
      operationId: "admin.media.update",
      summary: "Update alt text, display order or rights",
      description: "A published image must still meet the publish rules after the change.",
      request: {
        params: idParams,
        headers: changeHeaders,
        body: {
          required: true,
          content: json(mediaPatchSchema, {
            rightsBasis: "owned",
            evidenceRef: "drive/photos/2026-11-01",
            commercialUseOk: true,
          }),
        },
      },
      responses: {
        200: {
          description: "Updated.",
          headers: etagHeader.extend(replayHeader.shape),
          content: json(adminMediaResponseSchema),
        },
        ...ADMIN_ERRORS,
        ...errors("not_found", "conflict", "idempotency_mismatch"),
      },
    }),
  );

  registry.registerPath(
    transition(
      "/api/admin/media/{id}/publish",
      "Publish an image",
      "Copies it to public storage under a new unguessable key. Needs complete rights, and its venue or pitch must not be archived.",
      "media",
    ),
  );
  registry.registerPath(
    transition(
      "/api/admin/media/{id}/unpublish",
      "Unpublish an image",
      "Deletes the public copy, so its old URL stops working, and returns the image to draft.",
      "media",
    ),
  );

  return new OpenApiGeneratorV31([
    ...registry.definitions,
    // Referenced only from components/responses, so it has to be listed. (A bare Zod 4 schema has its own
    // `type` property, which the generator mistakes for a definition kind; hence the wrapper.)
    { type: "schema", schema: errorSchema },
  ]).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "FieldFinder API",
      version: "1.0.0",
      description:
        "Public read-only search over published soccer venues and pitches, plus the admin API used to curate them. Errors are always `{ code, message, requestId }`. See docs/api/README.md.",
    },
    servers: [{ url: SERVER_URL, description: "Placeholder; use your deployment's origin." }],
    tags: [
      { name: "Public", description: "No authentication. Rate limited per IP at the edge." },
      { name: "Admin", description: "Bearer token with the listed scope. Rate limited per token and per IP." },
    ],
  });
}
