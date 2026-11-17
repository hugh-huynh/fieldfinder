import type { TestProject } from "vitest/node";

import { localStorageEnv, prepareLocalDatabase } from "./local-db.ts";

// Global setup for the integration project (PRs 2.7, 2.9). Runs once, as the local superuser-like
// `postgres` role, and refuses to touch anything but a database on this machine.
//
// The local roles and seed check live in ./local-db.ts (shared with the E2E global setup).

declare module "vitest" {
  export interface ProvidedContext {
    /** Local S3 credentials from `supabase status`, set as env vars by integration-storage.ts. */
    storageEnv: Record<string, string>;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  project.provide("storageEnv", localStorageEnv());
  await prepareLocalDatabase();
}
