import { describe, expect, it } from "vitest";

import type { PitchDto } from "@/features/pitches/dto";

import { pitchFacts } from "./pitch-facts";

const pitch = (overrides: Partial<PitchDto> = {}): PitchDto => ({
  id: "p1",
  venueId: "v1",
  venueSlug: "test-venue",
  slug: "main-pitch",
  name: "Main pitch",
  surface: null,
  pitchFormat: null,
  lengthMeters: null,
  widthMeters: null,
  floodlights: null,
  access: null,
  effectiveAccess: null,
  updatedAt: "2026-11-01T00:00:00Z",
  ...overrides,
});

describe("pitchFacts", () => {
  it("words every confirmed fact", () => {
    expect(
      pitchFacts(
        pitch({
          surface: "synthetic",
          pitchFormat: "full",
          lengthMeters: 100,
          widthMeters: 64,
          floodlights: true,
          effectiveAccess: "booking_required",
        }),
      ),
    ).toEqual(["Synthetic", "Full size", "100 × 64 m", "Floodlights", "Booking required"]);
  });

  it("says no floodlights only when that's confirmed", () => {
    expect(pitchFacts(pitch({ floodlights: false }))).toEqual(["No floodlights"]);
  });

  it("leaves out anything not confirmed, including half a size", () => {
    expect(pitchFacts(pitch())).toEqual([]);
    expect(pitchFacts(pitch({ lengthMeters: 100 }))).toEqual([]);
  });
});
