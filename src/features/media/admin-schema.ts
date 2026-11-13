import { z } from "zod";

// Admin media payloads (PR 2.12). Limits mirror the media_assets CHECKs in migration 0002. Rights may
// be incomplete while an image is a draft; publishing then requires them (ADR-0006, DB publish gate).

export const RIGHTS_BASES = [
  "owned",
  "licensed",
  "cc0_public_domain",
  "cc_by",
  "cc_by_sa",
  "written_permission",
] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const httpUrl = z.url({ protocol: /^https?$/ }).max(2000);

const rightsFields = {
  rightsBasis: z.enum(RIGHTS_BASES).nullable(),
  author: text(200).nullable(),
  sourceUrl: httpUrl.nullable(),
  licenseName: text(200).nullable(),
  licenseUrl: httpUrl.nullable(),
  attributionText: text(500).nullable(),
  /** Pointer to private evidence (a file path, ticket or email id), never the evidence itself. */
  evidenceRef: text(500).nullable(),
  commercialUseOk: z.boolean().nullable(),
};

const editable = {
  altText: text(300),
  displayOrder: z.number().int().min(0).max(1000),
  ...rightsFields,
};

/** Text fields of the multipart upload (the file itself is separate). Exactly one owner. */
export const mediaUploadSchema = z
  .object({
    venueId: z.uuid().optional(),
    pitchId: z.uuid().optional(),
    altText: editable.altText,
    displayOrder: editable.displayOrder.optional(),
    rightsBasis: rightsFields.rightsBasis.optional(),
    author: rightsFields.author.optional(),
    sourceUrl: rightsFields.sourceUrl.optional(),
    licenseName: rightsFields.licenseName.optional(),
    licenseUrl: rightsFields.licenseUrl.optional(),
    attributionText: rightsFields.attributionText.optional(),
    evidenceRef: rightsFields.evidenceRef.optional(),
    commercialUseOk: rightsFields.commercialUseOk.optional(),
  })
  .strict()
  .refine((v) => (v.venueId === undefined) !== (v.pitchId === undefined), {
    message: "give exactly one of venueId or pitchId",
    path: ["venueId"],
  });

export const mediaPatchSchema = z.object(editable).partial().strict();

export type MediaUpload = z.output<typeof mediaUploadSchema>;
export type MediaPatch = z.output<typeof mediaPatchSchema>;

/** API field → media_assets column, for the editable fields. */
export const MEDIA_COLUMNS = {
  altText: "alt_text",
  displayOrder: "display_order",
  rightsBasis: "rights_basis",
  author: "author",
  sourceUrl: "source_url",
  licenseName: "license_name",
  licenseUrl: "license_url",
  attributionText: "attribution_text",
  evidenceRef: "evidence_ref",
  commercialUseOk: "commercial_use_ok",
} as const satisfies Record<keyof MediaPatch, string>;

/**
 * Multipart text fields are all strings; turn them into the JSON shapes the schema expects.
 * `commercialUseOk` is "true"/"false", `displayOrder` a whole number, and an empty value means null.
 */
export function fieldsFromForm(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) {
    if (name === "file") continue;
    if (typeof value !== "string") {
      out[name] = value; // a second file under another name: the strict schema rejects it
      continue;
    }
    if (name in out) {
      out[name] = [out[name], value]; // repeated field: the schema rejects arrays
    } else if (value === "") {
      out[name] = null;
    } else if (name === "commercialUseOk") {
      out[name] = value === "true" ? true : value === "false" ? false : value;
    } else if (name === "displayOrder") {
      out[name] = /^\d{1,4}$/.test(value) ? Number(value) : value;
    } else {
      out[name] = value;
    }
  }
  return out;
}

/** Default and maximum page sizes for GET /api/admin/media?unused=true (PR 2.16). */
export const DEFAULT_UNUSED_PAGE = 50;
export const MAX_UNUSED_LIMIT = 100;

/**
 * Query for the unused-images list. Strict, and `unused=true` is required, so this can only ever
 * list unused images: it isn't a general media listing.
 */
export const unusedMediaQuerySchema = z
  .object({
    unused: z.literal("true").meta({ description: "Required. Only unused images can be listed." }),
    limit: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(MAX_UNUSED_LIMIT))
      .optional()
      .meta({
        description: `Items per page, 1 to ${String(MAX_UNUSED_LIMIT)}. Default ${String(DEFAULT_UNUSED_PAGE)}.`,
      }),
    cursor: z.uuid().optional().meta({ description: "`nextCursor` from the previous page." }),
  })
  .strict();
