// Uploads synthetic placeholder images for the fixture media (PR 2.12; Hugh, 2026-11-09). The seed marks
// some fixture images as published, but their objects only exist once uploaded, so without this
// staging pages show broken images. Each placeholder is a plain coloured tile labelled with the
// fixture's alt text: no real photos, nothing private.
//
//   pnpm media:upload-fixtures            # dry run: lists what would be uploaded, and where
//   pnpm media:upload-fixtures --yes      # uploads
//
// Uses the same variables as the app: SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION,
// SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY. Run it with staging's values in your own
// shell; they're never printed. Every fixture gets a private original (media-private/<storageKey>), and
// published ones also get their public copy (media-public/<publicKey>). Re-running overwrites them.

import { parseArgs } from "node:util";

import { AwsClient } from "aws4fetch";
import sharp from "sharp";

import { assertObjectKey } from "../src/lib/storage/types.ts";
import { fixtures } from "../tests/fixtures/venues.ts";

function fail(message: string): never {
  console.error(`upload-fixture-images: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({ options: { yes: { type: "boolean" } }, strict: true });

const env = (name: string) => process.env[name]?.trim() ?? fail(`${name} is missing`);
const endpoint = env("SUPABASE_S3_ENDPOINT").replace(/\/+$/, "");
if (!/^https?:\/\//.test(endpoint)) fail("SUPABASE_S3_ENDPOINT is not an http(s) URL");
const s3 = new AwsClient({
  accessKeyId: env("SUPABASE_S3_ACCESS_KEY_ID"),
  secretAccessKey: env("SUPABASE_S3_SECRET_ACCESS_KEY"),
  region: env("SUPABASE_S3_REGION"),
  service: "s3",
});

const media = fixtures.venues.flatMap((v) => [...v.media, ...v.pitches.flatMap((p) => p.media)]);
const escape = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

/** A coloured tile with the alt text, at the fixture's dimensions. The colour varies by fixture. */
async function placeholder(width: number, height: number, label: string, index: number): Promise<Uint8Array> {
  const hue = (index * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">
    <rect width="100%" height="100%" fill="hsl(${String(hue)}, 45%, 38%)"/>
    <text x="50%" y="46%" font-family="sans-serif" font-size="${String(Math.round(height / 14))}" fill="#fff"
          text-anchor="middle">${escape(label)}</text>
    <text x="50%" y="58%" font-family="sans-serif" font-size="${String(Math.round(height / 24))}" fill="#e6efe9"
          text-anchor="middle">Synthetic placeholder (fixture)</text>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer());
}

async function put(bucket: string, key: string, bytes: Uint8Array): Promise<void> {
  assertObjectKey(key);
  const res = await s3.fetch(`${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    body: new Uint8Array(bytes), // plain ArrayBuffer-backed copy, as fetch's BodyInit requires
    headers: { "content-type": "image/webp", "content-length": String(bytes.byteLength) },
  });
  await res.body?.cancel();
  if (!res.ok) fail(`upload to ${bucket}/${key} failed with HTTP ${String(res.status)}`);
}

const host = new URL(endpoint).host;
console.error(`${values.yes === true ? "Uploading" : "Dry run:"} ${String(media.length)} fixture images to ${host}`);
for (const [i, m] of media.entries()) {
  const targets = [`media-private/${m.storageKey}`, ...(m.publicKey === null ? [] : [`media-public/${m.publicKey}`])];
  console.error(`  ${m.id}  ${m.status.padEnd(9)} → ${targets.join(", ")}`);
  if (values.yes !== true) continue;
  const bytes = await placeholder(m.widthPx, m.heightPx, m.altText.replace(/ff-private-sentinel/g, "").trim(), i);
  await put("media-private", m.storageKey, bytes);
  if (m.publicKey !== null) await put("media-public", m.publicKey, bytes);
}
console.error(values.yes === true ? "Done." : "Nothing uploaded. Re-run with --yes to upload.");
