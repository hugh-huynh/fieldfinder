import { assertObjectKey, type Bucket, type MediaStore } from "./types";

// In-memory MediaStore for unit tests. Same contract as the S3 one.

export function createMemoryMediaStore(): MediaStore & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const id = (bucket: Bucket, key: string) => {
    assertObjectKey(key);
    return `${bucket}/${key}`;
  };
  return {
    objects,
    // async, so a bad key rejects the promise exactly as the S3 store does, rather than throwing.
    async put(bucket, key, bytes, contentType) {
      await Promise.resolve();
      objects.set(id(bucket, key), { bytes: new Uint8Array(bytes), contentType });
    },
    async get(bucket, key) {
      await Promise.resolve();
      return objects.get(id(bucket, key))?.bytes ?? null;
    },
    async delete(bucket, key) {
      await Promise.resolve();
      objects.delete(id(bucket, key));
    },
  };
}
