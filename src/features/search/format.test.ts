import { describe, expect, it } from "vitest";

import { availableAmenities, creditLine, formatDistance, pitchCountLabel, pitchSummaryLabels } from "./format";

describe("formatDistance", () => {
  it.each([
    [0, "0 m"],
    [44, "40 m"],
    [995, "1.0 km"],
    [1000, "1.0 km"],
    [2149, "2.1 km"],
    [9960, "10 km"],
    [12_400, "12 km"],
  ])("%s m → %s", (meters, text) => {
    expect(formatDistance(meters)).toBe(text);
  });
});

describe("pitchCountLabel", () => {
  it.each([
    [1, 1, "1 pitch"],
    [4, 4, "4 pitches"],
    [4, 2, "2 of 4 pitches match"],
    [1, 0, "0 of 1 pitch match"],
  ])("%s published, %s matching → %s", (published, matching, text) => {
    expect(pitchCountLabel(published, matching)).toBe(text);
  });
});

describe("pitchSummaryLabels", () => {
  it("words confirmed characteristics only", () => {
    expect(
      pitchSummaryLabels({ surfaces: ["grass", "synthetic"], formats: ["full", "training"], floodlights: true }),
    ).toEqual(["Grass + synthetic", "Full size · Training", "Floodlights"]);
  });

  it.each([
    ["nothing confirmed", { surfaces: [], formats: [], floodlights: null }],
    ["confirmed unlit", { surfaces: [], formats: [], floodlights: false }],
  ] as const)("is empty for %s (never 'No floodlights' or 'Not confirmed' on a card)", (_name, summary) => {
    expect(pitchSummaryLabels({ ...summary, surfaces: [...summary.surfaces], formats: [...summary.formats] })).toEqual(
      [],
    );
  });
});

describe("availableAmenities", () => {
  it("keeps 'yes' only, in the canonical order", () => {
    expect(availableAmenities({ cafe: "yes", toilets: "no", parking: "yes" })).toEqual(["parking", "cafe"]);
    expect(availableAmenities({})).toEqual([]);
  });
});

describe("creditLine", () => {
  it("adds 'Photo:' once, whether or not the credit already has it", () => {
    expect(creditLine("A. Photographer, CC BY 4.0")).toBe("Photo: A. Photographer, CC BY 4.0");
    expect(creditLine("Photo: A. Photographer, CC BY 4.0")).toBe("Photo: A. Photographer, CC BY 4.0");
    expect(creditLine("photo by A. Photographer")).toBe("photo by A. Photographer");
    expect(creditLine("  Photographer's own  ")).toBe("Photo: Photographer's own");
  });
});
