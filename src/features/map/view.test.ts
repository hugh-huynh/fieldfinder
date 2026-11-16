import { describe, expect, it } from "vitest";

import { venueResult } from "../../../tests/msw/venues";

import {
  areaSearch,
  distanceKm,
  isPublicMapboxToken,
  mapAdapterKind,
  markerClassName,
  markerLabel,
  markerState,
  markerZIndex,
  radiusBounds,
  searchBounds,
  toMapMarker,
} from "./view";

// Map helpers (PR 3.4): what area to show, marker names and looks, and which map to draw.

const melbourne = { lat: -37.814, lng: 144.963 };

describe("radiusBounds", () => {
  it("holds a circle of the radius around the centre", () => {
    const b = radiusBounds(melbourne, 10);
    expect(b.north - melbourne.lat).toBeCloseTo(10 / 111.32, 6);
    expect(melbourne.lat - b.south).toBeCloseTo(10 / 111.32, 6);
    // Degrees of longitude are shorter away from the equator, so the box is wider in degrees.
    expect(b.east - melbourne.lng).toBeGreaterThan(b.north - melbourne.lat);
    expect(b.east - melbourne.lng).toBeCloseTo(melbourne.lng - b.west, 9);
  });
});

describe("searchBounds", () => {
  it("is the radius box when there are no venues", () => {
    expect(searchBounds(melbourne, 5, [])).toEqual(radiusBounds(melbourne, 5));
  });

  it("holds the searched place and every venue", () => {
    const b = searchBounds(melbourne, 10, [
      { lat: -37.7, lng: 145.1 },
      { lat: -37.9, lng: 144.9 },
    ]);
    expect(b).toEqual({ south: -37.9, west: 144.9, north: -37.7, east: 145.1 });
  });

  it("includes the place even when every venue is to one side", () => {
    const b = searchBounds(melbourne, 10, [{ lat: -37.7, lng: 145.1 }]);
    expect(b).toEqual({ south: -37.814, west: 144.963, north: -37.7, east: 145.1 });
  });
});

describe("markers", () => {
  it("are named by venue and published pitch count", () => {
    expect(markerLabel("Royal Park Sports Complex", 4)).toBe("Royal Park Sports Complex, 4 pitches");
    expect(markerLabel("Fairfield Park", 1)).toBe("Fairfield Park, 1 pitch");
  });

  it("show the published pitch count (not the matching count) at the venue's location", () => {
    const venue = venueResult(3, {
      name: "Test Oval",
      publishedPitchCount: 4,
      matchingPitchCount: 1,
      location: { latitude: -37.78, longitude: 144.95 },
    });
    expect(toMapMarker(venue)).toEqual({
      id: venue.id,
      position: { lat: -37.78, lng: 144.95 },
      count: 4,
      label: "Test Oval, 4 pitches",
    });
  });

  it("put selected above highlighted above the rest", () => {
    expect(markerState("a", "a", "a")).toBe("selected");
    expect(markerState("a", "a", "b")).toBe("highlighted");
    expect(markerState("a", "b", "c")).toBe("default");
    expect(markerState("a", null, null)).toBe("default");
    expect(markerZIndex("selected")).toBeGreaterThan(markerZIndex("highlighted"));
    expect(markerZIndex("highlighted")).toBeGreaterThan(markerZIndex("default"));
  });

  it("draw selected larger and darker, highlighted darker", () => {
    expect(markerClassName("default").split(" ")).toContain("bg-primary");
    expect(markerClassName("default")).not.toContain("scale-");
    expect(markerClassName("highlighted")).toContain("bg-primary-dark");
    expect(markerClassName("selected")).toContain("bg-primary-dark");
    expect(markerClassName("selected")).toContain("scale-125");
    expect(markerClassName("highlighted")).toContain("scale-110");
  });
});

describe("mapAdapterKind", () => {
  it("uses the fake map when asked, whatever the token", () => {
    expect(mapAdapterKind("fake", undefined)).toBe("fake");
    expect(mapAdapterKind("fake", "pk.abc")).toBe("fake");
  });

  it("uses Mapbox with a public token", () => {
    expect(mapAdapterKind(undefined, "pk.not-a-real-token")).toBe("mapbox");
    expect(mapAdapterKind("mapbox", " pk.abc ")).toBe("mapbox");
  });

  it.each([undefined, "", "   ", "sk.not-a-real-token", "tk.abc", "pk.", "pk.abc def", "<pk.abc>"])(
    "has no map for token %j",
    (token) => {
      expect(mapAdapterKind(undefined, token)).toBe("unavailable");
      expect(isPublicMapboxToken(token)).toBe(false);
    },
  );
});

describe("areaSearch (T5)", () => {
  it("measures distance on the globe", () => {
    // One degree of latitude is about 111.2 km anywhere.
    expect(distanceKm({ lat: -37, lng: 145 }, { lat: -38, lng: 145 })).toBeCloseTo(111.19, 1);
    expect(distanceKm(melbourne, melbourne)).toBe(0);
  });

  it("searches the viewport's centre with the whole-km radius whose circle covers it", () => {
    const viewport = radiusBounds(melbourne, 3); // corners are 3·√2 ≈ 4.24 km from the centre
    const area = areaSearch(viewport, 1, 50);
    expect(area.kind).toBe("search");
    if (area.kind !== "search") return;
    expect(area.centre.lat).toBeCloseTo(melbourne.lat, 9);
    expect(area.centre.lng).toBeCloseTo(melbourne.lng, 9);
    expect(area.radiusKm).toBe(5);
  });

  it("never goes below the smallest radius", () => {
    const tiny = { south: -37.8141, west: 144.9629, north: -37.8139, east: 144.9631 };
    expect(areaSearch(tiny, 1, 50)).toMatchObject({ kind: "search", radiusKm: 1 });
  });

  it("asks to zoom in when the viewport is wider than the largest radius covers", () => {
    // Corners at 36·√2 ≈ 50.9 km need 51 km: too wide. At 35·√2 ≈ 49.5 km, 50 km still covers it.
    expect(areaSearch(radiusBounds(melbourne, 36), 1, 50)).toEqual({ kind: "too-wide" });
    expect(areaSearch(radiusBounds(melbourne, 35), 1, 50)).toMatchObject({ kind: "search", radiusKm: 50 });
  });
});
