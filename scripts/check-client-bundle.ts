// Checks that no server secret reached the browser bundle (PR 2.13 acceptance; spec §4, CLAUDE.md
// rule 3). Run after `next build`:
//
//   MAPBOX_GEOCODING_TOKEN=pk.bundle-sentinel-… pnpm build && pnpm check:client-bundle
//
// It scans every file under .next/static (everything a browser can download) for:
//   * the names of server-only variables (a sign code read them on the client), and
//   * the values of any of those variables set in this environment, e.g. a sentinel token planted for
//     the build, which must never appear in client output.
//   * anything shaped like a credential (scripts/secret-patterns.ts: admin tokens, API keys, JWTs,
//     database URLs with passwords, private keys…), whatever its source (PR 2.15).
// Exits 1 with the file and the variable or pattern name (never the value) on any hit.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { findSecrets, SECRET_PATTERNS } from "./secret-patterns.ts";

const SERVER_ONLY = [
  "DATABASE_URL_PUBLIC_READER",
  "DATABASE_URL_ADMIN_WRITER",
  "DATABASE_URL_OPERATOR",
  "SEARCH_CURSOR_SECRET",
  "SUPABASE_S3_ACCESS_KEY_ID",
  "SUPABASE_S3_SECRET_ACCESS_KEY",
  "MAPBOX_GEOCODING_TOKEN",
];

const root = join(process.cwd(), ".next", "static");
let files: string[];
try {
  files = walk(root);
} catch {
  console.error("check-client-bundle: .next/static not found; run `pnpm build` first");
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const needles = [
  ...SERVER_ONLY.map((name) => ({ label: `the name ${name}`, text: name })),
  ...SERVER_ONLY.flatMap((name) => {
    const value = process.env[name]?.trim();
    return value !== undefined && value.length >= 8 ? [{ label: `the value of ${name}`, text: value }] : [];
  }),
];

const hits: string[] = [];
for (const file of files) {
  const content = readFileSync(file, "latin1");
  for (const needle of needles)
    if (content.includes(needle.text)) hits.push(`${relative(process.cwd(), file)}: ${needle.label}`);
  for (const name of findSecrets(content))
    hits.push(`${relative(process.cwd(), file)}: something shaped like a ${name}`);
}

const checkedValues = needles.length - SERVER_ONLY.length;
if (hits.length > 0) {
  console.error(`check-client-bundle: server secrets found in client output:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.error(
  `check-client-bundle: ${String(files.length)} client files clean (${String(SERVER_ONLY.length)} names, ${String(checkedValues)} values, ${String(SECRET_PATTERNS.length)} secret patterns checked)`,
);
