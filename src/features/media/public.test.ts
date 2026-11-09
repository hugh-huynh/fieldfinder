import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, type LogLevel } from "@/lib/log";

import { searchImages, venueMedia } from "./public";

// Public images when MEDIA_PUBLIC_BASE_URL is or isn't usable (PR 2.12): a misconfiguration must
// drop images, not fail the whole search or page.

const VENUE = "5eed0000-0000-4000-8000-000000000001";
const row = {
  id: "5eed0000-0000-4000-8002-000000000001",
  venue_id: VENUE,
  pitch_id: null,
  owner_venue: VENUE,
  public_key: "p/AbCdEfGhIjKlMnOpQrStUvWxYz012345.webp",
  content_type: "image/webp",
  width_px: 1600,
  height_px: 1067,
  alt_text: "Entrance gates",
  display_order: 0,
  author: null,
  source_url: null,
  license_name: null,
  license_url: null,
  attribution_text: null,
};

/** Fake postgres.js tagged template that answers every query with `rows`. */
const fakeSql = (rows: unknown[]) => (() => Promise.resolve(rows)) as unknown as Parameters<typeof venueMedia>[0];

function capture() {
  const lines: { level: LogLevel; line: string }[] = [];
  return { logger: createLogger((level, line) => lines.push({ level, line }), "debug"), lines };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public images", () => {
  it("builds URLs from MEDIA_PUBLIC_BASE_URL", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "https://media.example/storage/v1/object/public/media-public/");
    const [media] = await venueMedia(fakeSql([row]), VENUE);
    expect(media?.url).toBe(
      "https://media.example/storage/v1/object/public/media-public/p/AbCdEfGhIjKlMnOpQrStUvWxYz012345.webp",
    );
    const images = await searchImages(fakeSql([row]), [VENUE]);
    expect(images.get(VENUE)?.id).toBe(row.id);
  });

  it.each([
    ["missing", undefined],
    ["not a URL", "media-public"],
    ["quoted", '"https://media.example/media-public"'],
  ])("leaves images out and logs an error when it's %s, instead of failing", async (_name, value) => {
    if (value === undefined) vi.stubEnv("MEDIA_PUBLIC_BASE_URL", undefined);
    else vi.stubEnv("MEDIA_PUBLIC_BASE_URL", value);
    const { logger, lines } = capture();

    await expect(venueMedia(fakeSql([row]), VENUE, logger)).resolves.toEqual([]);
    await expect(searchImages(fakeSql([row]), [VENUE], logger)).resolves.toEqual(new Map());

    expect(lines).toHaveLength(2);
    for (const { level, line } of lines) {
      expect(level).toBe("error");
      expect(JSON.parse(line)).toMatchObject({ event: "media.public_base_url_unavailable", omittedImages: 1 });
      if (value !== undefined) expect(line).not.toContain(value); // the bad value is never logged
    }
  });

  it("doesn't need the variable at all when there are no images", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", undefined);
    const { logger, lines } = capture();
    await expect(venueMedia(fakeSql([]), VENUE, logger)).resolves.toEqual([]);
    expect(lines).toEqual([]);
  });
});
