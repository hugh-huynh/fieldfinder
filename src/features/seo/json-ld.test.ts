import { describe, expect, it } from "vitest";

import type { PitchDto } from "@/features/pitches/dto";
import type { MediaDto, VenueDetailDto } from "@/features/venues/dto";

import { pitchJsonLd, serializeJsonLd, venueJsonLd } from "./json-ld";

// Structured data from published DTOs (PR 4.2). Synthetic data.

const absolute = (path: string) => `https://ff.test${path}`;

function venue(overrides: Partial<VenueDetailDto> = {}): VenueDetailDto {
  return {
    id: "v1",
    slug: "test-reserve",
    name: "Test Reserve",
    streetAddress: "1 Example Parade",
    suburb: "Testville",
    state: "VIC",
    postcode: "3054",
    location: { latitude: -37.784, longitude: 144.972 },
    description: "A synthetic venue.",
    access: "public",
    publishedPitchCount: 1,
    amenities: { toilets: "yes", cafe: "no" },
    updatedAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function pitch(overrides: Partial<PitchDto> = {}): PitchDto {
  return {
    id: "p1",
    venueId: "v1",
    venueSlug: "test-reserve",
    slug: "east-pitch",
    name: "East pitch",
    surface: "grass",
    pitchFormat: "full",
    lengthMeters: 100,
    widthMeters: 64,
    floodlights: true,
    access: null,
    effectiveAccess: "public",
    updatedAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const photo: MediaDto = {
  id: "m1",
  url: "https://media.test/one.webp",
  contentType: "image/webp",
  width: 1600,
  height: 900,
  alt: "The east pitch",
  displayOrder: 0,
  attribution: null,
};

const venueUrls = { venue: "/venues/test-reserve", pitch: (p: PitchDto) => `/venues/test-reserve/pitches/${p.slug}` };
const pitchUrls = { pitch: "/venues/test-reserve/pitches/east-pitch", venue: "/venues/test-reserve" };

/** Every key anywhere in a JSON value. */
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)]);
  }
  return [];
}

const FORBIDDEN = [
  "aggregateRating",
  "review",
  "reviews",
  "rating",
  "priceRange",
  "price",
  "offers",
  "isAccessibleForFree",
  "openingHours",
  "openingHoursSpecification",
  "telephone",
  "email",
];

describe("venueJsonLd", () => {
  it("describes a venue with its confirmed facts and pitches", () => {
    expect(venueJsonLd(venue(), [pitch()], [photo], venueUrls, absolute)).toEqual({
      "@context": "https://schema.org",
      "@type": "SportsActivityLocation",
      name: "Test Reserve",
      url: "https://ff.test/venues/test-reserve",
      description: "A synthetic venue.",
      address: {
        "@type": "PostalAddress",
        streetAddress: "1 Example Parade",
        addressLocality: "Testville",
        addressRegion: "VIC",
        postalCode: "3054",
        addressCountry: "AU",
      },
      geo: { "@type": "GeoCoordinates", latitude: -37.784, longitude: 144.972 },
      image: ["https://media.test/one.webp"],
      amenityFeature: [
        { "@type": "LocationFeatureSpecification", name: "Toilets", value: true },
        { "@type": "LocationFeatureSpecification", name: "Café", value: false },
      ],
      publicAccess: true,
      containsPlace: [
        {
          "@type": "SportsActivityLocation",
          name: "East pitch",
          url: "https://ff.test/venues/test-reserve/pitches/east-pitch",
        },
      ],
    });
  });

  it("leaves out everything unknown rather than guessing", () => {
    const data = venueJsonLd(
      venue({ streetAddress: null, postcode: null, description: null, access: null, amenities: {} }),
      [],
      [],
      venueUrls,
      absolute,
    );
    expect(data).not.toHaveProperty("description");
    expect(data).not.toHaveProperty("image");
    expect(data).not.toHaveProperty("amenityFeature");
    expect(data).not.toHaveProperty("publicAccess");
    expect(data).not.toHaveProperty("containsPlace");
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Testville",
      addressRegion: "VIC",
      addressCountry: "AU",
    });
  });

  it.each([
    ["public", true],
    ["members_only", false],
    ["booking_required", undefined],
    [null, undefined],
  ] as const)("maps access %j to publicAccess %j", (access, expected) => {
    expect(venueJsonLd(venue({ access }), [], [], venueUrls, absolute).publicAccess).toBe(expected);
  });

  it("has no ratings, reviews, prices, offers or opening hours", () => {
    const all = keys(venueJsonLd(venue(), [pitch()], [photo], venueUrls, absolute));
    for (const key of FORBIDDEN) expect(all).not.toContain(key);
  });
});

describe("pitchJsonLd", () => {
  it("describes a pitch with its specs, the venue's facilities and the venue it's in", () => {
    expect(pitchJsonLd(pitch(), venue(), [photo], pitchUrls, absolute)).toEqual({
      "@context": "https://schema.org",
      "@type": "SportsActivityLocation",
      name: "East pitch at Test Reserve",
      url: "https://ff.test/venues/test-reserve/pitches/east-pitch",
      address: expect.objectContaining({ addressLocality: "Testville" }) as unknown,
      geo: { "@type": "GeoCoordinates", latitude: -37.784, longitude: 144.972 },
      image: ["https://media.test/one.webp"],
      amenityFeature: [
        { "@type": "LocationFeatureSpecification", name: "Floodlights", value: true },
        { "@type": "LocationFeatureSpecification", name: "Toilets", value: true },
        { "@type": "LocationFeatureSpecification", name: "Café", value: false },
      ],
      additionalProperty: [
        { "@type": "PropertyValue", name: "Surface", value: "Grass" },
        { "@type": "PropertyValue", name: "Pitch size", value: "Full size" },
        { "@type": "PropertyValue", name: "Length", value: 100, unitCode: "MTR" },
        { "@type": "PropertyValue", name: "Width", value: 64, unitCode: "MTR" },
      ],
      publicAccess: true,
      containedInPlace: {
        "@type": "SportsActivityLocation",
        name: "Test Reserve",
        url: "https://ff.test/venues/test-reserve",
      },
    });
  });

  it("leaves out unconfirmed specs, floodlights and access", () => {
    const data = pitchJsonLd(
      pitch({
        surface: null,
        pitchFormat: null,
        lengthMeters: null,
        widthMeters: null,
        floodlights: null,
        effectiveAccess: null,
      }),
      venue({ amenities: {} }),
      [],
      pitchUrls,
      absolute,
    );
    expect(data).not.toHaveProperty("additionalProperty");
    expect(data).not.toHaveProperty("amenityFeature");
    expect(data).not.toHaveProperty("publicAccess");
    expect(data).not.toHaveProperty("image");
  });

  it("says unlit when floodlights are confirmed absent", () => {
    expect(
      pitchJsonLd(pitch({ floodlights: false }), venue({ amenities: {} }), [], pitchUrls, absolute).amenityFeature,
    ).toEqual([{ "@type": "LocationFeatureSpecification", name: "Floodlights", value: false }]);
  });

  it("has no ratings, reviews, prices, offers or opening hours", () => {
    const all = keys(pitchJsonLd(pitch(), venue(), [photo], pitchUrls, absolute));
    for (const key of FORBIDDEN) expect(all).not.toContain(key);
  });
});

describe("serializeJsonLd", () => {
  it("can't be broken out of by text from the database", () => {
    const hostile = "</script><script>alert(1)</script><!-- & \u2028\u2029";
    const out = serializeJsonLd({ name: hostile });
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual({ name: hostile });
  });
});
