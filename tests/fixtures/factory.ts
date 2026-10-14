import type { MediaFixture, PitchFixture, VenueFixture } from "./types.ts";

// Deterministic UUIDs in a namespace that pgTAP tests never use (they use 00000000-…).
// Format: 5eed0000-0000-4000-<kind>-<12-digit index>.
const KIND = { venue: "8000", pitch: "8001", media: "8002", source: "8003", verification: "8004" } as const;

export type FixtureKind = keyof typeof KIND;

export function fixtureId(kind: FixtureKind, index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 999_999_999_999) {
    throw new RangeError(`fixture index must be an integer between 1 and 999999999999, got ${index}`);
  }
  return `5eed0000-0000-4000-${KIND[kind]}-${String(index).padStart(12, "0")}`;
}

/** A published-looking venue with every optional attribute unknown. Override what the case needs. */
export function makeVenue(
  index: number,
  overrides: Partial<VenueFixture> & Pick<VenueFixture, "slug" | "name">,
): VenueFixture {
  return {
    id: fixtureId("venue", index),
    streetAddress: null,
    suburb: "Testville",
    state: "VIC",
    postcode: null,
    latitude: -37.8136,
    longitude: 144.9631,
    description: null,
    access: null,
    status: "published",
    amenities: {},
    pitches: [],
    media: [],
    ...overrides,
  };
}

/** A published pitch with every attribute unknown (NULL), as the schema allows. */
export function makePitch(
  index: number,
  overrides: Partial<PitchFixture> & Pick<PitchFixture, "slug" | "name">,
): PitchFixture {
  return {
    id: fixtureId("pitch", index),
    surface: null,
    pitchFormat: null,
    lengthM: null,
    widthM: null,
    floodlights: null,
    access: null,
    status: "published",
    media: [],
    ...overrides,
  };
}

/** A draft image with no rights metadata. Use `publishedOwnedMedia` for a publishable one. */
export function makeMedia(
  index: number,
  overrides: Partial<MediaFixture> & Pick<MediaFixture, "altText">,
): MediaFixture {
  return {
    id: fixtureId("media", index),
    storageKey: `fixtures/${String(index)}.webp`,
    publicKey: null,
    contentType: "image/webp",
    widthPx: 1600,
    heightPx: 1067,
    byteSize: 240_000,
    displayOrder: 0,
    status: "draft",
    rightsBasis: null,
    author: null,
    sourceUrl: null,
    licenseName: null,
    licenseUrl: null,
    attributionText: null,
    evidenceRef: null,
    commercialUseOk: null,
    ...overrides,
  };
}

/** A published image that satisfies the 0002 publish gate with `owned` rights. */
export function publishedOwnedMedia(index: number, altText: string, displayOrder = 0): MediaFixture {
  return makeMedia(index, {
    altText,
    displayOrder,
    status: "published",
    publicKey: `fixtures/public/${fixtureId("media", index)}.webp`,
    rightsBasis: "owned",
    evidenceRef: `fixtures/evidence/${String(index)}`,
    commercialUseOk: true,
  });
}
