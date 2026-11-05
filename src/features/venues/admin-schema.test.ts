import { describe, expect, it } from "vitest";

import { pitchCreateSchema, pitchPatchSchema } from "@/features/pitches/admin-schema";

import { toAdminVenueDto } from "./admin-dto";
import { venueCreateSchema, venuePatchSchema } from "./admin-schema";

const VENUE = {
  slug: "example-reserve",
  name: "Example Reserve",
  suburb: "Testville",
  state: "VIC",
  latitude: -37.8,
  longitude: 144.9,
};

describe("venueCreateSchema", () => {
  it("accepts the required fields and trims text", () => {
    const parsed = venueCreateSchema.parse({ ...VENUE, name: "  Example Reserve  " });
    expect(parsed.name).toBe("Example Reserve");
  });

  it("accepts every optional field, with null for 'not confirmed'", () => {
    const parsed = venueCreateSchema.safeParse({
      ...VENUE,
      streetAddress: null,
      postcode: "3000",
      description: null,
      access: null,
      amenities: { parking: "yes", cafe: "unknown" },
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["an unknown field", { ...VENUE, status: "published" }],
    ["a missing required field", { ...VENUE, name: undefined }],
    ["a blank name", { ...VENUE, name: "   " }],
    ["a name over 200 characters", { ...VENUE, name: "x".repeat(201) }],
    ["a bad slug", { ...VENUE, slug: "Example Reserve" }],
    ["a state outside Australia", { ...VENUE, state: "CA" }],
    ["a bad postcode", { ...VENUE, postcode: "30000" }],
    ["latitude out of range", { ...VENUE, latitude: 91 }],
    ["longitude out of range", { ...VENUE, longitude: -181 }],
    ["a non-finite coordinate", { ...VENUE, latitude: Number.POSITIVE_INFINITY }],
    ["a coordinate as a string", { ...VENUE, latitude: "-37.8" }],
    ["an unknown access class", { ...VENUE, access: "staff_only" }],
    ["an unknown amenity", { ...VENUE, amenities: { sauna: "yes" } }],
    ["an unknown amenity state", { ...VENUE, amenities: { parking: "maybe" } }],
    ["a null required field", { ...VENUE, suburb: null }],
  ])("rejects %s", (_name, input) => {
    expect(venueCreateSchema.safeParse(input).success).toBe(false);
  });
});

describe("venuePatchSchema", () => {
  it("accepts any subset, including an empty patch", () => {
    expect(venuePatchSchema.safeParse({}).success).toBe(true);
    expect(venuePatchSchema.safeParse({ name: "New Name" }).success).toBe(true);
    expect(venuePatchSchema.safeParse({ amenities: { toilets: "no" } }).success).toBe(true);
  });

  it("still rejects unknown fields and nulls for required ones", () => {
    expect(venuePatchSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(venuePatchSchema.safeParse({ status: "archived" }).success).toBe(false);
    expect(venuePatchSchema.safeParse({ name: null }).success).toBe(false);
  });
});

describe("pitch schemas", () => {
  it("accept a pitch with unknown attributes", () => {
    expect(pitchCreateSchema.safeParse({ slug: "pitch-1", name: "Pitch 1" }).success).toBe(true);
  });

  it.each([
    ["one decimal place", 105.5, true],
    ["a whole number", 68, true],
    ["two decimal places (would be silently rounded)", 105.25, false],
    ["zero", 0, false],
    ["over 200 m", 200.1, false],
  ])("length with %s", (_name, lengthMeters, ok) => {
    expect(pitchCreateSchema.safeParse({ slug: "p", name: "P", lengthMeters }).success).toBe(ok);
  });

  it("rejects a width over 150 m, unknown fields and a venue move", () => {
    expect(pitchCreateSchema.safeParse({ slug: "p", name: "P", widthMeters: 151 }).success).toBe(false);
    expect(pitchPatchSchema.safeParse({ venueId: "5eed0000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(pitchPatchSchema.safeParse({ floodlights: "yes" }).success).toBe(false);
  });
});

describe("toAdminVenueDto", () => {
  const row = {
    id: "5eed0000-0000-4000-8000-000000000001",
    slug: "example-reserve",
    name: "Example Reserve",
    street_address: null,
    suburb: "Testville",
    state: "VIC",
    postcode: null,
    latitude: -37.8,
    longitude: 144.9,
    description: null,
    access: null,
    status: "draft",
    amenities: { parking: "yes" },
    created_at: new Date("2026-10-22T00:00:00Z"),
    updated_at: new Date("2026-10-22T00:00:01Z"),
    version: "1761091201000000",
    location: "0101000020E6100000…",
    internal_notes: "never exposed",
  };

  it("lists every amenity, unrecorded ones as unknown, and drops unexpected columns", () => {
    const dto = toAdminVenueDto(row);
    expect(dto.amenities).toEqual({
      parking: "yes",
      toilets: "unknown",
      changing_rooms: "unknown",
      drinking_water: "unknown",
      cafe: "unknown",
      public_transport: "unknown",
    });
    expect(dto).not.toHaveProperty("location");
    expect(dto).not.toHaveProperty("internal_notes");
    expect(dto.version).toBe("1761091201000000");
  });
});
