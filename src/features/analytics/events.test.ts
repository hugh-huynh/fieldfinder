import { describe, expect, it } from "vitest";

import { defaultFilters } from "@/features/search/state";

import { activeFilterTypes, EVENT_SCHEMAS, filterParams, parseEvent, searchType } from "./events";

// The typed GA4 event schema (spec §7, PR 4.1): the §7 names, snake_case, and only allowlisted
// parameters. Anything else is rejected, so it can never be sent.

const VENUE = "5eed0000-0000-4000-8000-000000000001";
const PITCH = "5eed0000-0000-4000-8000-000000000002";
const SEARCH = { result_count: 4, radius_km: 10, filter_count: 0, filter_types: "none" };

describe("EVENT_SCHEMAS", () => {
  it("has exactly the spec §7 events (no booking link: there are no booking links)", () => {
    expect(Object.keys(EVENT_SCHEMAS).sort()).toEqual(
      [
        "click_directions",
        "filter_fields",
        "nearby_search",
        "no_search_results",
        "search_fields",
        "select_map_marker",
        "view_pitch",
        "view_venue",
      ].sort(),
    );
    for (const name of Object.keys(EVENT_SCHEMAS)) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it.each([
    ["search_fields", { ...SEARCH, search_type: "place" }],
    ["search_fields", { ...SEARCH, search_type: "area" }],
    ["nearby_search", SEARCH],
    ["filter_fields", { radius_km: 5, filter_count: 2, filter_types: "radius,surface" }],
    ["no_search_results", { search_type: "nearby", radius_km: 1, filter_count: 1, filter_types: "amenities" }],
    ["view_venue", { venue_id: VENUE, source: "list" }],
    ["view_pitch", { venue_id: VENUE, pitch_id: PITCH, source: "direct" }],
    ["select_map_marker", { venue_id: VENUE, source: "map" }],
    ["click_directions", { venue_id: VENUE }],
    ["click_directions", { venue_id: VENUE, pitch_id: PITCH }],
  ])("accepts a well-formed %s", (name, params) => {
    expect(parseEvent(name, params)).toEqual({ name, params });
  });

  it.each([
    ["an extra coordinate", "search_fields", { ...SEARCH, search_type: "place", lat: -37.81 }],
    ["the typed place", "search_fields", { ...SEARCH, search_type: "place", place: "1 Smith St" }],
    ["an extra email", "view_venue", { venue_id: VENUE, source: "list", email: "a@b.co" }],
    ["a slug for an id", "view_venue", { venue_id: "ironbark-park", source: "list" }],
    ["an unknown source", "view_venue", { venue_id: VENUE, source: "email" }],
    ["a fractional radius", "filter_fields", { radius_km: 2.5, filter_count: 0, filter_types: "none" }],
    ["a radius past 50 km", "filter_fields", { radius_km: 51, filter_count: 0, filter_types: "none" }],
    ["free text in filter_types", "filter_fields", { radius_km: 5, filter_count: 1, filter_types: "near me" }],
    ["nearby as a place search", "search_fields", { ...SEARCH, search_type: "nearby" }],
    ["a missing parameter", "nearby_search", { result_count: 1 }],
    ["an unknown event", "click_booking_link", {}],
  ])("rejects %s", (_label, name, params) => {
    expect(parseEvent(name, params)).toBeNull();
  });
});

describe("from search state", () => {
  it("lists the filters that differ from their defaults, in a fixed order", () => {
    expect(activeFilterTypes(defaultFilters(), 10)).toEqual([]);
    expect(
      activeFilterTypes(
        { ...defaultFilters(), amenities: ["toilets"], lighting: false, radiusKm: 5, surface: "grass" },
        10,
      ),
    ).toEqual(["radius", "surface", "lighting", "amenities"]);
  });

  it("gives every search event's shared parameters, never the place", () => {
    expect(filterParams(defaultFilters(), 10)).toEqual({ radius_km: 10, filter_count: 0, filter_types: "none" });
    expect(filterParams({ ...defaultFilters(), pitchSize: "full", access: "public" }, 10)).toEqual({
      radius_km: 10,
      filter_count: 2,
      filter_types: "pitch_size,access",
    });
  });

  it("tells a place, a map area and the device's location apart", () => {
    expect(searchType({ lat: -37.81, lng: 144.96, label: "Carlton" }, false)).toBe("place");
    expect(searchType({ lat: -37.81, lng: 144.96, label: null }, false)).toBe("area");
    expect(searchType({ lat: -37.81, lng: 144.96, label: "Your location" }, true)).toBe("nearby");
  });
});
