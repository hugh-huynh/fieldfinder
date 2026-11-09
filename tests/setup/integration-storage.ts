import { inject } from "vitest";

// Per-file setup for the integration project (PR 2.12): the local S3 credentials that
// tests/setup/integration-db.ts read from `supabase status`, put where src/lib/env.ts looks for them.
Object.assign(process.env, inject("storageEnv"));
