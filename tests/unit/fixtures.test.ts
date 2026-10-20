import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fixtureId, makePitch, makeVenue } from "../fixtures/factory.ts";
import { renderSeedSql, sqlLiteral } from "../fixtures/seed-sql.ts";
import { fixtures, PRIVATE_SENTINEL } from "../fixtures/venues.ts";

const seedPath = fileURLToPath(new URL("../../supabase/seed.sql", import.meta.url));
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const pitches = fixtures.venues.flatMap((v) => v.pitches.map((p) => ({ venue: v, pitch: p })));
const media = [...fixtures.venues.flatMap((v) => v.media), ...pitches.flatMap(({ pitch }) => pitch.media)];

describe("fixture dataset", () => {
  it("has stable counts (update deliberately when adding fixtures)", () => {
    const publicVenues = fixtures.venues.filter(
      (v) => v.status === "published" && v.pitches.some((p) => p.status === "published"),
    );
    expect({
      venues: fixtures.venues.length,
      publicVenues: publicVenues.length,
      pitches: pitches.length,
      media: media.length,
      publishedMedia: media.filter((m) => m.status === "published").length,
      sources: fixtures.sources.length,
      verifications: fixtures.verifications.length,
    }).toMatchInlineSnapshot(`
      {
        "media": 7,
        "pitches": 21,
        "publicVenues": 11,
        "publishedMedia": 5,
        "sources": 1,
        "venues": 14,
        "verifications": 1,
      }
    `);
  });

  it("covers the 0/1/many published pitch cases", () => {
    const publishedCounts = fixtures.venues
      .filter((v) => v.status === "published")
      .map((v) => v.pitches.filter((p) => p.status === "published").length);
    expect(publishedCounts).toContain(0);
    expect(publishedCounts).toContain(1);
    expect(Math.max(...publishedCounts)).toBeGreaterThanOrEqual(3);
  });

  it("covers hidden venues, unknown attributes and missing images", () => {
    expect(fixtures.venues.some((v) => v.status === "draft")).toBe(true);
    expect(fixtures.venues.some((v) => v.status === "archived")).toBe(true);
    expect(pitches.some(({ venue, pitch }) => venue.status === "published" && pitch.status === "draft")).toBe(true);
    expect(pitches.some(({ venue, pitch }) => venue.status === "published" && pitch.status === "archived")).toBe(true);
    expect(
      pitches.some(
        ({ pitch }) =>
          pitch.surface === null && pitch.pitchFormat === null && pitch.floodlights === null && pitch.access === null,
      ),
    ).toBe(true);
    expect(
      fixtures.venues.some(
        (v) => v.status === "published" && v.media.length === 0 && v.pitches.every((p) => p.media.length === 0),
      ),
    ).toBe(true);
  });

  it("has unique ids and slugs that satisfy the schema", () => {
    const ids = [
      ...fixtures.venues.map((v) => v.id),
      ...pitches.map(({ pitch }) => pitch.id),
      ...media.map((m) => m.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);

    const venueSlugs = fixtures.venues.map((v) => v.slug);
    expect(new Set(venueSlugs).size).toBe(venueSlugs.length);
    for (const v of fixtures.venues) {
      expect(v.slug).toMatch(SLUG);
      const pitchSlugs = v.pitches.map((p) => p.slug);
      expect(new Set(pitchSlugs).size, `pitch slugs unique within ${v.slug}`).toBe(pitchSlugs.length);
      for (const s of pitchSlugs) expect(s).toMatch(SLUG);
    }
  });

  it("keeps coordinates in range and published media publishable", () => {
    for (const v of fixtures.venues) {
      expect(Math.abs(v.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(v.longitude)).toBeLessThanOrEqual(180);
    }
    for (const m of media) {
      if (m.status === "published") {
        expect(m.publicKey, m.id).not.toBeNull();
        expect(m.rightsBasis, m.id).not.toBeNull();
        expect(m.commercialUseOk, m.id).toBe(true);
      } else {
        expect(m.publicKey, m.id).toBeNull();
      }
    }
  });

  it("marks every hidden or private value with the sentinel, and never a public one", () => {
    const hiddenNames = [
      ...fixtures.venues
        .filter((v) => v.status !== "published" || v.pitches.every((p) => p.status !== "published"))
        .map((v) => v.name),
      ...pitches.filter(({ pitch }) => pitch.status === "draft").map(({ pitch }) => pitch.name),
    ];
    // Pitches inside hidden venues may have plain names; the venue name carries the marker.
    expect(hiddenNames.filter((n) => n.includes(PRIVATE_SENTINEL)).length).toBeGreaterThanOrEqual(4);
    expect(fixtures.verifications.every((f) => f.internalNotes?.includes(PRIVATE_SENTINEL))).toBe(true);

    for (const m of media.filter((x) => x.status === "published")) {
      expect(JSON.stringify([m.altText, m.publicKey, m.attributionText])).not.toContain(PRIVATE_SENTINEL);
    }
  });
});

describe("seed.sql", () => {
  it("matches the fixtures (run `pnpm seed:generate` after editing tests/fixtures/venues.ts)", () => {
    expect(readFileSync(seedPath, "utf8")).toBe(renderSeedSql(fixtures));
  });

  it("is deterministic", () => {
    expect(renderSeedSql(fixtures)).toBe(renderSeedSql(fixtures));
  });

  it("escapes quotes in values", () => {
    expect(renderSeedSql(fixtures)).toContain("'Banksia''s Corner Reserve'");
  });
});

describe("sqlLiteral", () => {
  it("renders each value type", () => {
    expect(sqlLiteral(null)).toBe("null");
    expect(sqlLiteral(true)).toBe("true");
    expect(sqlLiteral(-37.8136)).toBe("-37.8136");
    expect(sqlLiteral("it's")).toBe("'it''s'");
  });

  it("rejects values that can't be represented safely", () => {
    expect(() => sqlLiteral(Number.NaN)).toThrow(RangeError);
    expect(() => sqlLiteral(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => sqlLiteral("a\0b")).toThrow(RangeError);
  });

  it("keeps an injection attempt inside one string literal", () => {
    expect(sqlLiteral("x'); drop table venues; --")).toBe("'x''); drop table venues; --'");
  });
});

describe("factory", () => {
  it("builds deterministic ids per kind", () => {
    expect(fixtureId("venue", 1)).toBe("5eed0000-0000-4000-8000-000000000001");
    expect(fixtureId("pitch", 12)).toBe("5eed0000-0000-4000-8001-000000000012");
    expect(fixtureId("venue", 1)).not.toBe(fixtureId("pitch", 1));
  });

  it("rejects out-of-range indexes", () => {
    expect(() => fixtureId("venue", 0)).toThrow(RangeError);
    expect(() => fixtureId("venue", 1.5)).toThrow(RangeError);
  });

  it("defaults unknown attributes to null, never a guess", () => {
    const pitch = makePitch(99, { slug: "p", name: "P" });
    expect([pitch.surface, pitch.pitchFormat, pitch.floodlights, pitch.access, pitch.lengthM]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const venue = makeVenue(99, { slug: "v", name: "V" });
    expect(venue.access).toBeNull();
    expect(venue.amenities).toEqual({});
  });
});
