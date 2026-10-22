import postgres from "postgres";

import { LOCAL_ADMIN_URL, LOCAL_READER_URL, LOCAL_WRITER_URL } from "./integration-env.ts";

// Global setup for the integration project (PRs 2.7, 2.9). Runs once, as the local superuser-like
// `postgres` role, and refuses to touch anything but a database on this machine.
//
// The app roles are created NOLOGIN by migration 0003. Here, on the LOCAL container only, both
// roles get throwaway passwords so tests can connect exactly as the app does. Hosted environments set
// their own passwords from their secret stores (docs/architecture/data-model.md).

const ADMIN_URL = LOCAL_ADMIN_URL;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function assertLocal(url: string, name: string): void {
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`${name} must point at a local database; integration tests never run against remote hosts`);
  }
}

export default async function setup(): Promise<void> {
  assertLocal(ADMIN_URL, "the admin URL");
  assertLocal(LOCAL_READER_URL, "the reader URL");
  assertLocal(LOCAL_WRITER_URL, "the writer URL");

  const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined, connect_timeout: 5 });
  try {
    for (const [role, url] of [
      ["ff_public_reader", LOCAL_READER_URL],
      ["ff_admin_writer", LOCAL_WRITER_URL],
    ] as const) {
      const password = decodeURIComponent(new URL(url).password);
      await sql.unsafe(`alter role ${role} login password '${password.replaceAll("'", "''")}'`);
    }

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
