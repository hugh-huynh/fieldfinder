import { prepareLocalDatabase } from "../setup/local-db.ts";

// Playwright global setup (PR 3.10). The database-backed specs (detail pages) run only with E2E_DB=1,
// against the LOCAL Supabase stack (`pnpm db:start`, seeded by `pnpm db:reset`); this gives the app's
// roles their local throwaway passwords first. Without E2E_DB those specs skip and nothing here runs.

export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_DB === "1") await prepareLocalDatabase();
}
