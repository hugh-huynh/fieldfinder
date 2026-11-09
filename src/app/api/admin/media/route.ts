import { createHash } from "node:crypto";

import { fieldsFromForm, mediaUploadSchema } from "@/features/media/admin-schema";
import { createMedia } from "@/features/media/admin-service";
import { ApiError } from "@/lib/api/errors";
import { parseInput } from "@/lib/api/handler";
import { formatEtag } from "@/lib/api/version";
import { MAX_UPLOAD_BYTES, processUpload } from "@/lib/media/image";

import { adminRoute } from "../_lib/admin-route";
import { mediaDeps } from "../_lib/media";
import { runMutation } from "../_lib/mutation";

// POST /api/admin/media — upload an image for a venue or pitch (spec §5, PR 2.12, ADR-0006).
// multipart/form-data: `file` plus `venueId` or `pitchId`, `altText` (required), optional
// `displayOrder` and rights fields. The image is validated and re-encoded (src/lib/media/image.ts)
// and stored privately as a draft; it has no public URL until it's published. Scope media:write.
// Optional Idempotency-Key.

/** The file plus a little room for the text fields and multipart framing. */
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export const POST = adminRoute("admin.media.upload", "media:write", async (request, context) => {
  if (!/^multipart\/form-data;\s*boundary=/i.test(request.headers.get("content-type") ?? "")) {
    throw new ApiError("invalid_request", "Upload with Content-Type: multipart/form-data.");
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
    throw new ApiError("invalid_request", "The image is larger than 10 MB.");
  }
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_REQUEST_BYTES) throw new ApiError("invalid_request", "The image is larger than 10 MB.");

  let form: FormData;
  try {
    form = await new Response(raw, {
      headers: { "content-type": String(request.headers.get("content-type")) },
    }).formData();
  } catch {
    throw new ApiError("invalid_request", "The upload isn't valid multipart/form-data.");
  }
  const files = form.getAll("file");
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) {
    throw new ApiError("invalid_request", "Send exactly one image in the `file` field.");
  }
  const fields = fieldsFromForm(form);
  const input = parseInput(mediaUploadSchema, fields);
  const original = new Uint8Array(await file.arrayBuffer());
  const image = await processUpload(original);

  const deps = mediaDeps();
  // Every multipart body has a random boundary, so a retry never has the same raw bytes. The
  // idempotency hash covers what the request means instead: the file's bytes and the text fields.
  const body = JSON.stringify([
    createHash("sha256").update(original).digest("hex"),
    Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return runMutation(request, context, { body, ifMatch: null }, async (tx) => {
    const media = await createMedia(tx, input, image, context, deps);
    return {
      status: 201,
      headers: { etag: formatEtag(media.version), location: `/api/admin/media/${media.id}` },
      body: { media },
    };
  });
});
