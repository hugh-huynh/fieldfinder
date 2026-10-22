// TLS for Postgres connections (security review, PR 2.9). postgres.js connects without TLS unless
// told otherwise, and an explicit `ssl` option overrides the URL's `sslmode`. So:
//   * a host on this machine (the local Supabase container) keeps the library default;
//   * a remote URL with sslmode=require / verify-ca / verify-full is left to the URL;
//   * a remote URL with any weaker sslmode is refused;
//   * a remote URL without sslmode gets `ssl: "require"`: encrypted, without certificate checks.
//     Use sslmode=verify-full with the provider's CA to also verify the server.
// No `server-only` import: scripts/admin-credential.ts uses this too.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const STRONG_MODES = new Set(["require", "verify-ca", "verify-full"]);

export function tlsOptions(url: string, name: string): { ssl?: "require" } {
  const parsed = new URL(url);
  if (LOCAL_HOSTS.has(parsed.hostname)) return {};
  const mode = parsed.searchParams.get("sslmode");
  if (mode === null) return { ssl: "require" };
  if (STRONG_MODES.has(mode)) return {};
  // The mode isn't secret; the rest of the URL is never echoed.
  throw new Error(`${name} must use TLS for a remote database (sslmode=require or stronger, not "${mode}")`);
}
