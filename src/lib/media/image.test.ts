import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { endsCleanly, MAX_UPLOAD_BYTES, OUTPUT_MAX_EDGE, processUpload, sniffImage } from "./image";

// Images are generated here, so no binary fixtures are checked in.

const base = (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: { r: 12, g: 120, b: 60 } } });

const jpegWithGps = () =>
  base()
    .jpeg()
    .withExif({
      IFD0: { Copyright: "ff-private-sentinel camera owner", Make: "TestCam" },
      IFD3: {
        GPSLatitudeRef: "S",
        GPSLatitude: "37/1 48/1 49/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "144/1 57/1 47/1",
      },
    })
    .toBuffer();

const bytes = (b: Buffer | Uint8Array) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

async function refusal(input: Uint8Array): Promise<string> {
  const error = await processUpload(input).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(400);
  return (error as ApiError).publicMessage;
}

describe("sniffImage", () => {
  it("recognises the accepted formats by their bytes", async () => {
    expect(sniffImage(bytes(await base().jpeg().toBuffer()))).toBe("jpeg");
    expect(sniffImage(bytes(await base().png().toBuffer()))).toBe("png");
    expect(sniffImage(bytes(await base().webp().toBuffer()))).toBe("webp");
    expect(sniffImage(bytes(await base().avif().toBuffer()))).toBe("avif");
  });

  it.each([
    ["SVG", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["XML-prefixed SVG", '<?xml version="1.0"?><svg/>'],
    ["HTML", "<!doctype html><script>alert(1)</script>"],
    ["GIF", "GIF89a\u0001\u0000\u0001\u0000"],
    ["empty", ""],
  ])("refuses %s", (_name, content) => {
    expect(sniffImage(text(content))).toBeNull();
  });
});

describe("endsCleanly (polyglots)", () => {
  const zip = text("PK\u0003\u0004 pretend zip payload <script>alert(1)</script>");

  it.each(["jpeg", "png", "webp", "avif"] as const)(
    "accepts a plain %s and refuses one with data appended",
    async (format) => {
      const clean = bytes(await base().toFormat(format).toBuffer());
      expect(endsCleanly(clean, format)).toBe(true);
      expect(endsCleanly(concat(clean, zip), format)).toBe(false);
    },
  );
});

describe("processUpload", () => {
  it("re-encodes to WebP and drops EXIF and GPS", async () => {
    const input = bytes(await jpegWithGps());
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the test image really has EXIF

    const out = await processUpload(input);
    expect(out).toMatchObject({ contentType: "image/webp", width: 40, height: 30 });
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(Buffer.from(out.bytes).includes("ff-private-sentinel")).toBe(false);
    expect(Buffer.from(out.bytes).includes("TestCam")).toBe(false);
  });

  it("applies the EXIF orientation before dropping it", async () => {
    const rotated = bytes(await base(40, 30).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    const out = await processUpload(rotated);
    expect([out.width, out.height]).toEqual([30, 40]);
  });

  it("shrinks large images to the maximum edge, never enlarging small ones", async () => {
    const large = await processUpload(bytes(await base(4000, 1000).png().toBuffer()));
    expect([large.width, large.height]).toEqual([OUTPUT_MAX_EDGE, OUTPUT_MAX_EDGE / 4]);
    const small = await processUpload(bytes(await base(20, 10).png().toBuffer()));
    expect([small.width, small.height]).toEqual([20, 10]);
  });

  it.each(["png", "webp", "avif"] as const)("accepts %s", async (format) => {
    await expect(processUpload(bytes(await base().toFormat(format).toBuffer()))).resolves.toMatchObject({
      contentType: "image/webp",
    });
  });

  it("refuses SVG, GIF and HTML", async () => {
    expect(await refusal(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toMatch(/Unsupported image type/);
    expect(await refusal(bytes(await base().gif().toBuffer()))).toMatch(/Unsupported image type/);
    expect(await refusal(text("<html><body>hi</body></html>"))).toMatch(/Unsupported image type/);
  });

  it("refuses a polyglot: a valid JPEG with a payload appended", async () => {
    const polyglot = concat(bytes(await base().jpeg().toBuffer()), text("PK\u0003\u0004<script>alert(1)</script>"));
    expect(await refusal(polyglot)).toMatch(/unexpected data after its end/);
  });

  it("refuses bytes that only look like an image", async () => {
    // A JPEG header followed by garbage that still ends in FF D9.
    const fake = concat(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      text("not really a jpeg"),
      new Uint8Array([0xff, 0xd9]),
    );
    expect(await refusal(fake)).toMatch(/couldn't be decoded/);
  });

  it("refuses a truncated image", async () => {
    const full = bytes(await base(200, 200).jpeg().toBuffer());
    const truncated = concat(full.subarray(0, Math.floor(full.length / 2)), new Uint8Array([0xff, 0xd9]));
    expect(await refusal(truncated)).toMatch(/couldn't be decoded/);
  });

  it("refuses images over the dimension limit, and empty or oversized files", async () => {
    expect(await refusal(bytes(await base(10_001, 1).png().toBuffer()))).toMatch(/10,000 pixels/);
    expect(await refusal(new Uint8Array())).toMatch(/empty/);
    expect(await refusal(new Uint8Array(MAX_UPLOAD_BYTES + 1))).toMatch(/larger than 10 MB/);
  });
});
