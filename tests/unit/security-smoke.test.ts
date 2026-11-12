import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// scripts/security-smoke.ts against a fake `vercel` binary: whatever happens, the temporary file
// holding the admin token must not outlive the run.

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../scripts/security-smoke.ts", import.meta.url));
const TOKEN = `ffadm_${"A".repeat(43)}`; // synthetic, well-formed
const PREVIEW = "https://fieldfinder-test.vercel.app";

// Answers like the deployed API. With `-H @file` (the token) it answers `$AUTHED_STATUS`.
const FAKE_VERCEL = `#!/bin/sh
authed=no
for arg in "$@"; do [ "$arg" = "-H" ] && authed=yes; done
case "$2" in
  /api/venues\\?*) status=200; body='{"totalCount":3}' ;;
  /api/venues/*) status=404; body='{"code":"not_found","message":"Not found","requestId":"r1"}' ;;
  *)
    if [ "$authed" = yes ]; then status="$AUTHED_STATUS"; else status=401; fi
    if [ "$status" = 403 ]; then code=forbidden; else code=unauthenticated; fi
    body="{\\"code\\":\\"$code\\",\\"message\\":\\"No\\",\\"requestId\\":\\"r1\\"}" ;;
esac
printf 'HTTP/2 %s\\r\\nx-request-id: r1\\r\\n\\r\\n%s' "$status" "$body"
`;

let bin: string;
let tmp: string;

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "ff-fake-vercel-"));
  tmp = mkdtempSync(join(tmpdir(), "ff-smoke-tmp-"));
  writeFileSync(join(bin, "vercel"), FAKE_VERCEL, { mode: 0o755 });
});

afterEach(() => {
  rmSync(bin, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
});

async function smoke(authedStatus: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, PREVIEW], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        TMPDIR: tmp,
        FF_ADMIN_TOKEN: TOKEN,
        AUTHED_STATUS: authedStatus,
      },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout, stderr: e.stderr, code: e.code };
  }
}

describe("security smoke script", () => {
  it("removes the token file when a check fails after the authenticated request", async () => {
    const result = await smoke("401"); // e.g. an expired token instead of the expected 403
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("admin read, token without venues:write: expected 403 forbidden");
    expect(readdirSync(tmp)).toEqual([]);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it("removes the token file when every check passes up to the rate limit", async () => {
    const result = await smoke("403"); // the fake never answers 429, so the run ends there
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("✓ admin read, token without venues:write (403 forbidden)");
    expect(result.stderr).toContain("rate limit: no 429 within 15 unauthenticated requests");
    expect(readdirSync(tmp)).toEqual([]);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });
});
