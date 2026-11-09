import "server-only";

import { AwsClient } from "aws4fetch";

import type { StorageConfig } from "@/lib/env";

import { assertObjectKey, type Bucket, type MediaStore } from "./types";

// Supabase Storage through its S3-compatible API (PR 2.12; approved: S3 access keys, which reach
// Storage only). Path-style URLs: <endpoint>/<bucket>/<key>. Errors carry the operation and HTTP
// status only, never the response body, which can echo request details.

export function createS3MediaStore(config: StorageConfig): MediaStore {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });

  const url = (bucket: Bucket, key: string) => {
    assertObjectKey(key);
    return `${config.endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  };

  return {
    async put(bucket, key, bytes, contentType) {
      const response = await client.fetch(url(bucket, key), {
        method: "PUT",
        body: new Uint8Array(bytes), // a copy backed by a plain ArrayBuffer, as fetch's BodyInit requires
        headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`storage put failed with HTTP ${String(response.status)}`);
    },

    async get(bucket, key) {
      const response = await client.fetch(url(bucket, key), { method: "GET" });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`storage get failed with HTTP ${String(response.status)}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async delete(bucket, key) {
      const response = await client.fetch(url(bucket, key), { method: "DELETE" });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) {
        throw new Error(`storage delete failed with HTTP ${String(response.status)}`);
      }
    },
  };
}
