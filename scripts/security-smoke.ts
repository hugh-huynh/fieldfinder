// M2 exit evidence (PR 2.15 follow-up): a transcript against a deployed preview showing the API's
// 404, 401, 403 and 429 responses, all in the `{ code, message, requestId }` shape.
//
//   FF_ADMIN_TOKEN=ffadm_… pnpm security:smoke https://fieldfinder-xxxx-hugh16.vercel.app [--out file]
//
// FF_ADMIN_TOKEN must be a short-lived token that has `content:publish` and NOT `venues:write`,
// so the 403 step is a genuine scope refusal. Mint it yourself and revoke it afterwards:
//   pnpm admin:credential mint --label security-smoke-2026-11 --scopes content:publish --days 1
//
// The token is sent from a 0600 header file through `vercel curl` (which passes Vercel's deployment
// protection with your own login) and is never printed: the transcript shows it as "Bearer <redacted>".
//
// Steps, in this order because the last one blocks your IP from the admin API for up to a minute:
//   1. public search near Melbourne → 200 (the deployment is up and seeded);
//   2. a draft venue's page and a never-existing venue's page → the same 404;
//   3. an admin read with no token → 401;
//   4. an admin read with the token, which lacks venues:write → 403;
//   5. unauthenticated admin requests until the failed-login limit (10/min per IP) answers 429,
//      with Retry-After.
// Nothing is created or changed.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: { out: { type: "string" } },
  allowPositionals: true,
  strict: true,
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const deployment = positionals[0] ?? fail("usage: pnpm security:smoke <preview URL> [--out file]");
if (!/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(deployment)) fail("give a https://….vercel.app preview URL");
const token = process.env.FF_ADMIN_TOKEN ?? fail("FF_ADMIN_TOKEN is missing (see the header of this script)");
if (!/^ffadm_[A-Za-z0-9_-]{43}$/.test(token)) fail("FF_ADMIN_TOKEN doesn't look like an admin token");

const UNKNOWN_ID = "5eed0000-0000-4000-8000-0000ffffffff"; // well-formed, matches nothing
const DRAFT_VENUE = "hidden-draft-park"; // fixture 5: a draft venue in the staging seed
const work = mkdtempSync(join(tmpdir(), "ff-security-smoke-"));
const transcript: string[] = [];

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** One request through `vercel curl`, optionally with the admin token from a header file. */
function call(path: string, withToken: boolean): Reply {
  const args = ["curl", path, "--deployment", deployment, "--yes", "-s", "-i"];
  if (withToken) {
    const headerFile = join(work, "auth-header");
    writeFileSync(headerFile, `Authorization: Bearer ${token}\n`, { mode: 0o600 });
    args.push("-H", `@${headerFile}`);
  }
  const out = execFileSync("vercel", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const [head = "", ...rest] = out.split(/\r?\n\r?\n/);
  const status = Number(/HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1] ?? 0);
  const headers = Object.fromEntries(
    head
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(/:\s*/, 2))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([k, v]) => [k.toLowerCase(), v]),
  );
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rest.join("\n\n")) as Record<string, unknown>;
  } catch {
    // not JSON (e.g. a Vercel edge page); recorded as {}
  }
  const shown = Object.fromEntries(
    Object.entries(body).filter(([key]) => ["code", "message", "requestId", "totalCount"].includes(key)),
  );
  transcript.push(
    [
      `$ GET ${path}   (Authorization: ${withToken ? "Bearer <redacted>" : "none"})`,
      `  HTTP ${String(status)}` +
        (headers["retry-after"] === undefined ? "" : `   Retry-After: ${headers["retry-after"]}`) +
        (headers["cache-control"] === undefined ? "" : `   Cache-Control: ${headers["cache-control"]}`),
      `  ${JSON.stringify(shown)}`,
    ].join("\n"),
  );
  return { status, headers, body };
}

function expectError(reply: Reply, status: number, code: string, step: string): void {
  if (reply.status !== status || reply.body.code !== code) {
    fail(`${step}: expected ${String(status)} ${code}, got ${String(reply.status)} ${JSON.stringify(reply.body)}`);
  }
  const keys = Object.keys(reply.body).sort().join(",");
  if (keys !== "code,message,requestId") fail(`${step}: error body has unexpected fields (${keys})`);
  if (reply.headers["x-request-id"] !== reply.body.requestId) fail(`${step}: X-Request-Id doesn't match requestId`);
  console.error(`✓ ${step} (${String(status)} ${code})`);
}

try {
  const search = call("/api/venues?lat=-37.814&lng=144.963&radiusKm=50", false);
  if (search.status !== 200 || typeof search.body.totalCount !== "number") {
    fail(`search: expected 200 with results, got ${String(search.status)}; is the preview up and seeded?`);
  }
  console.error(`✓ public search (200, ${String(search.body.totalCount)} venues)`);

  const draft = call(`/api/venues/${DRAFT_VENUE}`, false);
  expectError(draft, 404, "not_found", "draft venue page");
  const missing = call("/api/venues/no-such-venue-anywhere", false);
  expectError(missing, 404, "not_found", "never-existing venue page");
  if (draft.body.message !== missing.body.message) fail("the draft and missing 404s differ");
  console.error("✓ a draft venue's 404 is identical to a missing one's");

  expectError(call(`/api/admin/venues/${UNKNOWN_ID}`, false), 401, "unauthenticated", "admin read, no token");
  expectError(
    call(`/api/admin/venues/${UNKNOWN_ID}`, true),
    403,
    "forbidden",
    "admin read, token without venues:write",
  );

  let limited: Reply | undefined;
  for (let attempt = 1; attempt <= 15 && limited === undefined; attempt += 1) {
    const reply = call(`/api/admin/venues/${UNKNOWN_ID}`, false);
    if (reply.status === 429) limited = reply;
    else if (reply.status !== 401) fail(`rate limit: attempt ${String(attempt)} got ${String(reply.status)}`);
  }
  if (limited === undefined) fail("rate limit: no 429 within 15 unauthenticated requests");
  expectError(limited, 429, "rate_limited", "repeated failed logins");
  if (limited.headers["retry-after"] === undefined) fail("rate limit: the 429 has no Retry-After");

  const text = [
    `FieldFinder security smoke against ${deployment} at ${new Date().toISOString()}`,
    "",
    ...transcript,
    "",
  ].join("\n");
  if (values.out === undefined) process.stdout.write(text);
  else {
    writeFileSync(values.out, text);
    console.error(`\nTranscript written to ${values.out}`);
  }
  console.error("\nAll good. Revoke the token now: pnpm admin:credential revoke --label <its label>");
  console.error("Your IP stays blocked from the admin API until the limiter's minute is up.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
