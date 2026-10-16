import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { keyPaths, seededRandom, SENTINEL, withRandomExtras } from "../../../tests/support/random";

import { toPitchDto } from "./dto";

const pitchRow = {
  id: "5eed0000-0000-4000-8001-000000000011",
  venue_id: "5eed0000-0000-4000-8000-000000000008",
  venue_slug: "kurrajong-recreation-ground",
  slug: "oval-1",
  name: "Oval 1",
  surface: "grass",
  pitch_format: "full",
  length_m: "105.0", // postgres.js returns numeric as a string
  width_m: "68.0",
  floodlights: true,
  access: null,
  effective_access: "booking_required",
  updated_at: "2026-10-01T00:00:00Z",
};

describe("toPitchDto", () => {
  it("maps a public pitch row, converting numeric strings", () => {
    expect(toPitchDto(pitchRow)).toEqual({
      id: pitchRow.id,
      venueId: pitchRow.venue_id,
      venueSlug: "kurrajong-recreation-ground",
      slug: "oval-1",
      name: "Oval 1",
      surface: "grass",
      pitchFormat: "full",
      lengthMeters: 105,
      widthMeters: 68,
      floodlights: true,
      access: null,
      effectiveAccess: "booking_required",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("keeps every unknown attribute as null (never false or a guess)", () => {
    const dto = toPitchDto({
      ...pitchRow,
      surface: null,
      pitch_format: null,
      length_m: null,
      width_m: null,
      floodlights: null,
      effective_access: null,
    });
    expect([
      dto.surface,
      dto.pitchFormat,
      dto.lengthMeters,
      dto.widthMeters,
      dto.floodlights,
      dto.effectiveAccess,
    ]).toEqual([null, null, null, null, null, null]);
  });

  it("drops every non-allowlisted key, including random extras (300 seeded cases)", () => {
    const expected = keyPaths(toPitchDto(pitchRow));
    const rand = seededRandom(1234);
    for (let i = 0; i < 300; i++) {
      const dto = toPitchDto(withRandomExtras(pitchRow, rand));
      expect(keyPaths(dto)).toEqual(expected);
      expect(JSON.stringify(dto)).not.toContain(SENTINEL);
    }
  });

  it("rejects values outside the public enums", () => {
    expect(() => toPitchDto({ ...pitchRow, surface: "astroturf" })).toThrow(ZodError);
    expect(() => toPitchDto({ ...pitchRow, length_m: "about 100" })).toThrow(ZodError);
  });
});
