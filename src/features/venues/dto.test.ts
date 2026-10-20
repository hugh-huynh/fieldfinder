import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { keyPaths, seededRandom, SENTINEL, withRandomExtras } from "../../../tests/support/random";

import { toAmenitiesDto, toMediaDto, toVenueDetailDto, toVenueSummaryDto } from "./dto";

const ID = "5eed0000-0000-4000-8000-000000000001";
const PITCH_ID = "5eed0000-0000-4000-8001-000000000001";
const url = (key: string) => `https://media.example/${key}`;

const searchRow = {
  venue_id: ID,
  slug: "wattlebird-reserve",
  name: "Wattlebird Reserve",
  suburb: "Carlton North",
  state: "VIC",
  latitude: -37.784,
  longitude: 144.972,
  access: "public",
  distance_m: 3411.62,
  published_pitch_count: 1,
  matching_pitch_count: 1,
  single_pitch_slug: "main-pitch",
  total_count: "7", // postgres.js returns bigint as a string; not part of the DTO
};

const venueRow = {
  id: ID,
  slug: "paperbark-common",
  name: "Paperbark Common",
  street_address: null,
  suburb: "Parkville",
  state: "VIC",
  postcode: null,
  latitude: -37.79,
  longitude: 144.951,
  description: null,
  access: null,
  published_pitch_count: 1,
  amenities: { toilets: "yes", cafe: "no" },
  updated_at: new Date("2026-10-01T00:00:00Z"),
};

const mediaRow = {
  id: "5eed0000-0000-4000-8002-000000000005",
  venue_id: ID,
  pitch_id: null,
  public_key: "fixtures/public/5.webp",
  content_type: "image/webp",
  width_px: 1600,
  height_px: 1067,
  alt_text: "Goalmouth in afternoon light",
  display_order: 1,
  author: "Example Photographer",
  source_url: "https://example.org/photos/goalmouth",
  license_name: "CC BY 4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution_text: "Photo: Example Photographer, CC BY 4.0",
};

const SUMMARY_KEYS = [
  "access",
  "distanceMeters",
  "href",
  "id",
  "location.latitude",
  "location.longitude",
  "matchingPitchCount",
  "name",
  "publishedPitchCount",
  "slug",
  "state",
  "suburb",
];

describe("toVenueSummaryDto", () => {
  it("maps a search row to the public summary", () => {
    expect(toVenueSummaryDto(searchRow)).toEqual({
      id: ID,
      slug: "wattlebird-reserve",
      name: "Wattlebird Reserve",
      suburb: "Carlton North",
      state: "VIC",
      location: { latitude: -37.784, longitude: 144.972 },
      access: "public",
      distanceMeters: 3412,
      publishedPitchCount: 1,
      matchingPitchCount: 1,
      href: "/venues/wattlebird-reserve/pitches/main-pitch",
    });
  });

  it("links a venue with several published pitches to the venue page", () => {
    const dto = toVenueSummaryDto({ ...searchRow, published_pitch_count: 3, single_pitch_slug: null });
    expect(dto.href).toBe("/venues/wattlebird-reserve");
  });

  it("keeps unknown access as null", () => {
    expect(toVenueSummaryDto({ ...searchRow, access: null }).access).toBeNull();
  });

  it("drops every non-allowlisted key, including random extras (300 seeded cases)", () => {
    const rand = seededRandom(20261016);
    for (let i = 0; i < 300; i++) {
      const dto = toVenueSummaryDto(withRandomExtras(searchRow, rand));
      expect(keyPaths(dto)).toEqual(SUMMARY_KEYS);
      expect(JSON.stringify(dto)).not.toContain(SENTINEL);
    }
  });

  it("rejects malformed rows instead of passing them through", () => {
    expect(() => toVenueSummaryDto({ ...searchRow, venue_id: "not-a-uuid" })).toThrow(ZodError);
    expect(() => toVenueSummaryDto({ ...searchRow, access: "staff_only" })).toThrow(ZodError);
    const withoutName: Record<string, unknown> = { ...searchRow };
    delete withoutName.name;
    expect(() => toVenueSummaryDto(withoutName)).toThrow(ZodError);
  });
});

describe("toVenueDetailDto", () => {
  it("keeps unknown values as null and converts the timestamp", () => {
    const dto = toVenueDetailDto(venueRow);
    expect(dto.streetAddress).toBeNull();
    expect(dto.postcode).toBeNull();
    expect(dto.description).toBeNull();
    expect(dto.access).toBeNull();
    expect(dto.updatedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("drops every non-allowlisted key, including random extras (300 seeded cases)", () => {
    const expected = keyPaths(toVenueDetailDto(venueRow));
    const rand = seededRandom(7);
    for (let i = 0; i < 300; i++) {
      const dto = toVenueDetailDto(withRandomExtras(venueRow, rand));
      expect(keyPaths(dto)).toEqual(expected);
      expect(JSON.stringify(dto)).not.toContain(SENTINEL);
    }
  });
});

describe("toAmenitiesDto", () => {
  it("keeps confirmed yes/no for known amenities only, in a stable order", () => {
    expect(
      toAmenitiesDto({
        cafe: "no",
        toilets: "yes",
        parking: "unknown",
        sauna: "yes",
        drinking_water: true,
        [SENTINEL]: "yes",
      }),
    ).toEqual({ toilets: "yes", cafe: "no" });
    expect(Object.keys(toAmenitiesDto({ cafe: "no", parking: "yes" }))).toEqual(["parking", "cafe"]);
  });

  it("never turns a missing amenity into 'no'", () => {
    expect(toAmenitiesDto({})).toEqual({});
  });
});

describe("toMediaDto", () => {
  it("builds the URL from the public key and includes required attribution", () => {
    expect(toMediaDto(mediaRow, url)).toEqual({
      id: mediaRow.id,
      url: "https://media.example/fixtures/public/5.webp",
      contentType: "image/webp",
      width: 1600,
      height: 1067,
      alt: "Goalmouth in afternoon light",
      displayOrder: 1,
      attribution: {
        text: "Photo: Example Photographer, CC BY 4.0",
        author: "Example Photographer",
        sourceUrl: "https://example.org/photos/goalmouth",
        licenseName: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      },
    });
  });

  it("has no attribution object for owned images", () => {
    const owned = {
      ...mediaRow,
      pitch_id: PITCH_ID,
      venue_id: null,
      author: null,
      source_url: null,
      license_name: null,
      license_url: null,
      attribution_text: null,
    };
    expect(toMediaDto(owned, url).attribution).toBeNull();
  });

  it("never exposes private media columns, even if a view started returning them (300 seeded cases)", () => {
    const leaky = {
      ...mediaRow,
      storage_key: `private/${SENTINEL}/5.webp`,
      evidence_ref: SENTINEL,
      rights_basis: SENTINEL,
    };
    const expected = keyPaths(toMediaDto(mediaRow, url));
    const rand = seededRandom(42);
    for (let i = 0; i < 300; i++) {
      const dto = toMediaDto(withRandomExtras(leaky, rand), url);
      expect(keyPaths(dto)).toEqual(expected);
      expect(JSON.stringify(dto)).not.toContain(SENTINEL);
    }
  });

  it("rejects content types other than the re-encoded formats", () => {
    expect(() => toMediaDto({ ...mediaRow, content_type: "image/svg+xml" }, url)).toThrow(ZodError);
  });
});
