import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { LOCAL_S3_ENDPOINT } from "../setup/integration-env.ts";
import { assertLocal, localStorageEnv, prepareLocalDatabase } from "../setup/local-db.ts";

// Playwright global setup (PRs 3.10, 3.12). The database-backed specs (detail pages) run only with
// E2E_DB=1, against the LOCAL Supabase stack (`pnpm db:start`, seeded by `pnpm db:reset`). Here:
// - the app's roles get their local throwaway passwords;
// - the seed's published photos get their synthetic placeholder files in LOCAL storage (the same
//   `pnpm media:upload-fixtures` used for staging), so detail pages show real images, through the
//   image optimiser where it's on. The endpoint must be on this machine.
// Without E2E_DB those specs skip and nothing here runs.

const UPLOAD_SCRIPT = fileURLToPath(new URL("../../scripts/upload-fixture-images.ts", import.meta.url));

export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_DB !== "1") return;
  await prepareLocalDatabase();
  assertLocal(LOCAL_S3_ENDPOINT, "the storage endpoint");
  execFileSync(process.execPath, [UPLOAD_SCRIPT, "--yes"], {
    env: { ...process.env, ...localStorageEnv(), SUPABASE_S3_ENDPOINT: LOCAL_S3_ENDPOINT },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
