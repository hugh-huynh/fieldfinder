import "server-only";

import sharp, { type Metadata } from "sharp";

import { ApiError } from "@/lib/api/errors";

// Image intake (PR 2.12, ADR-0006). Nothing a client uploads is stored as sent:
//   1. The type comes from the file's own bytes (magic numbers), never its name or Content-Type.
//      JPEG, PNG, WebP and AVIF only: SVG (script), GIF, HEIC, TIFF and everything else is refused.
//   2. Bytes after the format's own end marker are refused. That's where polyglots hide a second
//      payload (an image that is also a ZIP, HTML or script).
//   3. sharp decodes with pixel and dimension limits, then re-encodes to WebP. Re-encoding drops all
//      metadata (EXIF, GPS, XMP, comments) and anything else that isn't pixels. This decode/re-encode
//      is the "malware risk" mitigation; there's no antivirus service (D10, residual risk documented).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Matches the media_assets dimension CHECK (0002). */
export const MAX_DIMENSION = 10_000;
/** Decompression-bomb guard: refuse to decode more pixels than this. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Longest edge of the stored image. */
export const OUTPUT_MAX_EDGE = 2560;

export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

// Serverless memory: no libvips operation cache, one thread per image.
sharp.cache(false);
sharp.concurrency(1);

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** The image format from the file's leading bytes, or null for anything not accepted. */
export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) {
    return "avif";
  }
  return null;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** True when the file ends exactly where its format says it does (no appended second payload). */
export function endsCleanly(bytes: Uint8Array, format: ImageFormat): boolean {
  const n = bytes.length;
  switch (format) {
    case "jpeg":
      return n >= 4 && bytes[n - 2] === 0xff && bytes[n - 1] === 0xd9;
    case "png": {
      // Final chunk: length 0, "IEND", CRC ae 42 60 82.
      const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
      return n >= 20 && iend.every((b, i) => bytes[n - 12 + i] === b);
    }
    case "webp": {
      const riff = view(bytes).getUint32(4, true) + 8; // RIFF size excludes the 8-byte header
      return riff === n || (riff % 2 === 1 && riff + 1 === n); // optional pad byte
    }
    case "avif": {
      // Top-level ISO BMFF boxes must tile the file exactly.
      let offset = 0;
      while (offset < n) {
        if (n - offset < 8) return false;
        let size = view(bytes).getUint32(offset);
        if (size === 1) {
          if (n - offset < 16) return false;
          const big = view(bytes).getBigUint64(offset + 8);
          if (big > BigInt(n)) return false;
          size = Number(big);
        } else if (size === 0) {
          size = n - offset; // box runs to the end of the file
        }
        if (size < 8 || offset + size > n) return false;
        offset += size;
      }
      return offset === n;
    }
  }
}

export interface ProcessedImage {
  bytes: Uint8Array;
  contentType: "image/webp";
  width: number;
  height: number;
}

const invalid = (message: string) => new ApiError("invalid_request", message);

/** Validates an upload and re-encodes it to metadata-free WebP. Throws a 400 for anything refused. */
export async function processUpload(bytes: Uint8Array): Promise<ProcessedImage> {
  if (bytes.length === 0) throw invalid("The image file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw invalid("The image is larger than 10 MB.");

  const format = sniffImage(bytes);
  if (format === null) throw invalid("Unsupported image type. Upload a JPEG, PNG, WebP or AVIF image.");
  if (!endsCleanly(bytes, format)) throw invalid("The image has unexpected data after its end.");

  const options = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false } as const;
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, options).metadata();
  } catch {
    throw invalid("The image couldn't be decoded.");
  }
  // sharp reports AVIF as "heif". Anything else means the bytes aren't what their header claims.
  if (metadata.format !== (format === "avif" ? "heif" : format)) {
    throw invalid("The image's contents don't match its type.");
  }
  const { width, height, pages } = metadata;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw invalid("The image is wider or taller than 10,000 pixels.");
  if (pages !== undefined && pages > 1) throw invalid("Animated or multi-page images aren't supported.");

  try {
    const { data, info } = await sharp(bytes, options)
      .rotate() // apply the EXIF orientation before the metadata is dropped
      .resize({ width: OUTPUT_MAX_EDGE, height: OUTPUT_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true }); // no .withMetadata(): EXIF, GPS, XMP and ICC are dropped
    return { bytes: new Uint8Array(data), contentType: "image/webp", width: info.width, height: info.height };
  } catch {
    throw invalid("The image couldn't be decoded.");
  }
}
