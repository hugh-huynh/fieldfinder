// End-to-end media check against a deployed preview (PR 2.12; Hugh, 2026-11-09):
// upload → complete rights → publish → fetch the public URL → unpublish → the URL no longer works.
//
//   FF_ADMIN_TOKEN=ffadm_… pnpm media:smoke https://fieldfinder-xxxx-hugh16.vercel.app
//
// FF_ADMIN_TOKEN is a short-lived staging credential you mint yourself, e.g.
//   pnpm admin:credential mint --label smoke-2026-11 --scopes media:write,content:publish --days 1
// and revoke afterwards. It's never printed. Requests go through `vercel curl`, which passes Vercel's
// deployment protection with your own Vercel login; the public image URL is fetched directly.
//
// It uses the seeded fixture venue Wattlebird Reserve. The API has no delete (spec §5: soft states
// only), so the test image stays on staging as a draft labelled "Smoke test …", invisible publicly.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

const VENUE_ID = "5eed0000-0000-4000-8000-000000000001"; // Wattlebird Reserve (fixture 1)

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const deployment = process.argv[2] ?? fail("usage: pnpm media:smoke <preview URL>");
if (!/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(deployment)) fail("give a https://….vercel.app preview URL");
const token = process.env.FF_ADMIN_TOKEN ?? fail("FF_ADMIN_TOKEN is missing");
if (!/^ffadm_[A-Za-z0-9_-]{43}$/.test(token)) fail("FF_ADMIN_TOKEN doesn't look like an admin token");

const work = mkdtempSync(join(tmpdir(), "ff-smoke-"));

interface Reply {
  status: number;
  headers: Record<string, string>;
  json: Record<string, unknown>;
}

/** One request through `vercel curl`. Extra curl args after `--`. The token goes in a header file. */
function call(path: string, curlArgs: string[]): Reply {
  const headerFile = join(work, "auth-header");
  writeFileSync(headerFile, `Authorization: Bearer ${token}\n`, { mode: 0o600 });
  const out = execFileSync(
    "vercel",
    ["curl", path, "--deployment", deployment, "--yes", "-s", "-i", "-H", `@${headerFile}`, ...curlArgs],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const [head = "", ...bodyParts] = out.split(/\r?\n\r?\n/);
  const status = Number(/HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1] ?? 0);
  const headers = Object.fromEntries(
    head
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(/:\s*/, 2))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([k, v]) => [k.toLowerCase(), v]),
  );
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(bodyParts.join("\n\n")) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status, headers, json };
}

function expectStatus(reply: Reply, status: number, step: string): void {
  if (reply.status !== status)
    fail(`${step}: expected ${String(status)}, got ${String(reply.status)} ${JSON.stringify(reply.json)}`);
  console.error(`✓ ${step} (${String(status)})`);
}

try {
  // A JPEG with GPS EXIF, to confirm the stored image has none.
  const jpeg = await sharp({ create: { width: 320, height: 200, channels: 3, background: { r: 20, g: 120, b: 70 } } })
    .jpeg()
    .withExif({
      IFD3: {
        GPSLatitudeRef: "S",
        GPSLatitude: "37/1 47/1 2/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "144/1 58/1 19/1",
      },
    })
    .toBuffer();
  const file = join(work, "smoke.jpg");
  writeFileSync(file, jpeg);
  const stamp = new Date().toISOString().slice(0, 16);

  const uploaded = call("/api/admin/media", [
    "-F",
    `file=@${file};type=image/jpeg`,
    "-F",
    `venueId=${VENUE_ID}`,
    "-F",
    `altText=Smoke test ${stamp}`,
  ]);
  expectStatus(uploaded, 201, "upload");
  const media = uploaded.json.media as { id: string; version: string; publicUrl: string | null };
  if (media.publicUrl !== null) fail("a fresh upload must not have a public URL");

  const patched = call(`/api/admin/media/${media.id}`, [
    "-X",
    "PATCH",
    "-H",
    "content-type: application/json",
    "-H",
    `if-match: "${media.version}"`,
    "--data",
    JSON.stringify({ rightsBasis: "owned", evidenceRef: `smoke/${stamp}`, commercialUseOk: true }),
  ]);
  expectStatus(patched, 200, "complete rights");

  const published = call(`/api/admin/media/${media.id}/publish`, [
    "-X",
    "POST",
    "-H",
    `if-match: ${String(patched.headers.etag)}`,
  ]);
  expectStatus(published, 200, "publish");
  const url = (published.json.media as { publicUrl: string }).publicUrl;

  const live = await fetch(url);
  if (live.status !== 200) fail(`public URL should serve the image, got ${String(live.status)}`);
  const meta = await sharp(new Uint8Array(await live.arrayBuffer())).metadata();
  if (meta.format !== "webp" || meta.exif !== undefined) fail("the public image should be WebP without EXIF");
  console.error("✓ public URL serves a WebP with no EXIF (200)");

  const unpublished = call(`/api/admin/media/${media.id}/unpublish`, [
    "-X",
    "POST",
    "-H",
    `if-match: ${String(published.headers.etag)}`,
  ]);
  expectStatus(unpublished, 200, "unpublish");
  const gone = await fetch(url);
  if (gone.ok) fail(`the old public URL still works after unpublishing (${String(gone.status)})`);
  console.error(`✓ old public URL no longer works (${String(gone.status)})`);

  console.error(`\nAll good. Test image ${media.id} remains on staging as a draft ("Smoke test ${stamp}").`);
  console.error("Revoke the token now: pnpm admin:credential revoke --label <its label>");
} finally {
  rmSync(work, { recursive: true, force: true });
}
