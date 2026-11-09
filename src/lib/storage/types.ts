// Media object storage (PR 2.12, D10, ADR-0006). Two buckets (migration 0007): every re-encoded upload
// goes to the private one; only published images are copied to the public one, under an unguessable
// key, and that copy is deleted when they're unpublished. Backends: S3 protocol (./s3.ts) in the app,
// in-memory (./memory.ts) in unit tests.

export const PRIVATE_BUCKET = "media-private";
export const PUBLIC_BUCKET = "media-public";

export type Bucket = typeof PRIVATE_BUCKET | typeof PUBLIC_BUCKET;

export interface MediaStore {
  put(bucket: Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The object's bytes, or null when it doesn't exist. */
  get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
  /** Deleting a missing object is not an error. */
  delete(bucket: Bucket, key: string): Promise<void>;
}

/** Same rule as the media_assets key CHECKs in migration 0002. */
const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

export function assertObjectKey(key: string): void {
  if (!KEY.test(key) || key.includes("..") || key.length > 300) throw new Error("invalid storage key");
}
