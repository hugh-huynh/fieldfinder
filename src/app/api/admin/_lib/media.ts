import "server-only";

import type { MediaDeps } from "@/features/media/admin-service";
import { mediaPublicBaseUrl, storageConfig } from "@/lib/env";
import { createS3MediaStore } from "@/lib/storage/s3";

// Storage and public-URL wiring for the admin media routes (PR 2.12). Read per request, so a
// missing variable fails that request with a generic 500 instead of failing the build.

export function mediaDeps(): MediaDeps {
  const store = createS3MediaStore(storageConfig());
  const base = mediaPublicBaseUrl();
  return { store, publicUrl: (key) => `${base}/${key}` };
}
