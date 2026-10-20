import { describe, expect, it } from "vitest";

import { pitchPath, venuePath, venueRouteTarget } from "./route-target";

describe("venueRouteTarget", () => {
  it("sends a venue with exactly one published pitch to that pitch's page", () => {
    expect(venueRouteTarget("wattlebird-reserve", ["main-pitch"])).toBe(
      "/venues/wattlebird-reserve/pitches/main-pitch",
    );
  });

  it("sends a venue with several published pitches to the venue page", () => {
    expect(venueRouteTarget("ironbark-park", ["pitch-a", "pitch-b", "pitch-c"])).toBe("/venues/ironbark-park");
    expect(venueRouteTarget("saltbush-sports-park", ["east-pitch", "west-pitch"])).toBe("/venues/saltbush-sports-park");
  });

  it("falls back to the venue page when there is no published pitch", () => {
    expect(venueRouteTarget("lilly-pilly-fields", [])).toBe("/venues/lilly-pilly-fields");
  });
});

describe("paths", () => {
  it("builds the page URLs from slugs", () => {
    expect(venuePath("paperbark-common")).toBe("/venues/paperbark-common");
    expect(pitchPath("paperbark-common", "open-field")).toBe("/venues/paperbark-common/pitches/open-field");
  });

  it("encodes anything that isn't a valid slug instead of letting it change the path", () => {
    expect(pitchPath("a/b", "c?d#e")).toBe("/venues/a%2Fb/pitches/c%3Fd%23e");
  });
});
