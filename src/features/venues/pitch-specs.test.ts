import { describe, expect, it } from "vitest";

import type { PitchDto } from "@/features/pitches/dto";

import { pitchSpecs } from "./pitch-specs";

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

const values = (p: PitchDto) => Object.fromEntries(pitchSpecs(p).map((row) => [row.label, row.value]));

describe("pitchSpecs", () => {
  it("lists every spec as 'Not confirmed' when nothing is known", () => {
    expect(values(pitch())).toEqual({
      Surface: "Not confirmed",
      "Pitch size": "Not confirmed",
      Dimensions: "Not confirmed",
      Floodlights: "Not confirmed",
      Access: "Not confirmed",
    });
    expect(pitchSpecs(pitch()).find((row) => row.label === "Access")?.note).toBeUndefined();
  });

  it("words confirmed specs, including a confirmed 'No'", () => {
    expect(
      values(
        pitch({
          surface: "hybrid",
          pitchFormat: "small_sided",
          lengthMeters: 60,
          widthMeters: 40,
          floodlights: false,
          access: "members_only",
          effectiveAccess: "members_only",
        }),
      ),
    ).toEqual({
      Surface: "Hybrid",
      "Pitch size": "Small-sided",
      Dimensions: "60 × 40 m",
      Floodlights: "No",
      Access: "Members only",
    });
  });

  it("says which rule access comes from", () => {
    const own = pitchSpecs(pitch({ access: "booking_required", effectiveAccess: "booking_required" }));
    expect(own.find((row) => row.label === "Access")?.note).toBe("this pitch's own rule");
    const inherited = pitchSpecs(pitch({ access: null, effectiveAccess: "public" }));
    expect(inherited.find((row) => row.label === "Access")).toEqual({
      label: "Access",
      value: "Public access",
      note: "the venue's rule",
    });
  });

  it("shows half a size as such, never inventing the other half", () => {
    expect(values(pitch({ lengthMeters: 100 })).Dimensions).toBe("100 m long (width not confirmed)");
    expect(values(pitch({ widthMeters: 64 })).Dimensions).toBe("64 m wide (length not confirmed)");
  });
});
