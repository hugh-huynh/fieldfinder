import { describe, expect, it } from "vitest";

import { geoMessage, geoReducer, type GeoStatus } from "./geolocation";

// The "Use my location" state machine (PR 3.9).

describe("geoReducer", () => {
  it("starts unsupported without the Geolocation API, otherwise asks the Permissions API if it can", () => {
    expect(geoReducer("checking", { type: "init", supported: false, permissionsApi: true })).toBe("unsupported");
    expect(geoReducer("checking", { type: "init", supported: true, permissionsApi: true })).toBe("checking");
    // No Permissions API: undecided, so never automatic.
    expect(geoReducer("checking", { type: "init", supported: true, permissionsApi: false })).toBe("prompt");
  });

  it.each([
    ["granted", "granted"],
    ["prompt", "prompt"],
    ["denied", "denied"],
  ] as const)("permission %s → %s", (state, expected) => {
    expect(geoReducer("checking", { type: "permission", state })).toBe(expected);
  });

  it("a permission change doesn't interrupt reading the position, or revive an unsupported browser", () => {
    expect(geoReducer("locating", { type: "permission", state: "granted" })).toBe("locating");
    expect(geoReducer("unsupported", { type: "permission", state: "granted" })).toBe("unsupported");
  });

  it.each([
    [1, "denied"],
    [2, "unavailable"],
    [3, "timeout"],
    [99, "unavailable"],
  ] as const)("a failure with code %i → %s", (code, expected) => {
    expect(geoReducer("locating", { type: "failed", code })).toBe(expected);
  });

  it("locating from any supported state, and back to granted once located", () => {
    for (const from of ["prompt", "granted", "denied", "timeout", "unavailable", "checking"] as GeoStatus[]) {
      expect(geoReducer(from, { type: "locate" })).toBe("locating");
    }
    expect(geoReducer("unsupported", { type: "locate" })).toBe("unsupported");
    expect(geoReducer("locating", { type: "located" })).toBe("granted");
  });

  it("ignores results that arrive when not locating", () => {
    expect(geoReducer("prompt", { type: "located" })).toBe("prompt");
    expect(geoReducer("granted", { type: "failed", code: 1 })).toBe("granted");
  });
});

describe("geoMessage", () => {
  it("says something only while locating or after a failure, always pointing to manual search", () => {
    expect(geoMessage("locating")).toBe("Finding your location…");
    for (const status of ["denied", "timeout", "unavailable"] as const)
      expect(geoMessage(status)).toMatch(/search a place/);
    for (const status of ["prompt", "granted", "checking", "unsupported"] as const) expect(geoMessage(status)).toBe("");
  });
});
