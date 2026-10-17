import postgres from "postgres";

import { LOCAL_ADMIN_URL, LOCAL_READER_URL } from "./integration-env.ts";

// Global setup for the integration project (PR 2.7). Runs once, as the local superuser-like
// `postgres` role, and refuses to touch anything but a database on this machine.
//
// The app roles are created NOLOGIN by migration 0003. Here, on the LOCAL container only, the reader
// gets a throwaway password so tests can connect exactly as the app does. Hosted environments set
// their own passwords from their secret stores (docs/architecture/data-model.md).

const ADMIN_URL = LOCAL_ADMIN_URL;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function assertLocal(url: string, name: string): void {
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`${name} must point at a local database; integration tests never run against remote hosts`);
  }
}

export default async function setup(): Promise<void> {
  const readerUrl = LOCAL_READER_URL;
  assertLocal(ADMIN_URL, "the admin URL");
  assertLocal(readerUrl, "the reader URL");

  const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined, connect_timeout: 5 });
  try {
    const password = decodeURIComponent(new URL(readerUrl).password);
    await sql.unsafe(`alter role ff_public_reader login password '${password.replaceAll("'", "''")}'`);

    const [row] = await sql<{ count: string }[]>`select count(*)::text as count from public.venues`;
    if (row?.count === "0") {
      throw new Error("The local database has no seed data. Run `pnpm db:reset` first.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Integration DB setup failed (is \`pnpm db:start\` running?): ${message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
