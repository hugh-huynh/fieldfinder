import { describe, expect, it } from "vitest";

import { AMENITY_KEYS } from "@/lib/domain/enums";

import { canonicalQueryString, parseSearchQuery } from "./query";
import {
  activeFilterCount,
  apiQueryString,
  defaultFilters,
  deviceLocation,
  filterDialogReducer,
  initialFilterDialogState,
  MAX_PLACE_LABEL_LENGTH,
  parseSearchState,
  placeLocation,
  serializeSearchState,
  type FilterDialogState,
  type SearchState,
} from "./state";

const parse = (query: string) => parseSearchState(new URLSearchParams(query));
const brunswick = { lat: -37.767, lng: 144.962, label: "Brunswick VIC 3056" };

const SAMPLES: SearchState[] = [
  { location: null, filters: defaultFilters() },
  { location: brunswick, filters: defaultFilters() },
  {
    location: { lat: -37.81, lng: 144.96, label: null },
    filters: {
      radiusKm: 50,
      surface: "synthetic",
      pitchSize: "small_sided",
      lighting: false,
      access: "booking_required",
      amenities: [...AMENITY_KEYS],
    },
  },
  {
    location: { lat: 0, lng: -180, label: 'Fish & Chips Reserve, St Kilda ("the oval") ½' },
    filters: { ...defaultFilters(), radiusKm: 1, lighting: true, amenities: ["toilets"] },
  },
];

describe("URL round trip", () => {
  it.each(SAMPLES.map((s) => [serializeSearchState(s) || "(empty)", s] as const))(
    "%s parses back to the same state",
    (_name, state) => {
      expect(parse(serializeSearchState(state))).toEqual(state);
    },
  );

  it("writes one URL per search: fixed order, defaults left out, readable commas", () => {
    expect(serializeSearchState({ location: null, filters: defaultFilters() })).toBe("");
    expect(serializeSearchState({ location: brunswick, filters: defaultFilters() })).toBe(
      "lat=-37.767&lng=144.962&place=Brunswick+VIC+3056",
    );
    expect(
      serializeSearchState({
        location: { ...brunswick, label: null },
        filters: { ...defaultFilters(), amenities: ["toilets", "parking"], surface: "grass", radiusKm: 25 },
      }),
    ).toBe("lat=-37.767&lng=144.962&radiusKm=25&surface=grass&amenities=parking,toilets");
  });

  it("normalises any spelling of a search to the same URL", () => {
    const messy = "amenities=toilets,parking,toilets&surface=grass&lng=144.96200&lat=-37.7670&utm_source=x&radiusKm=10";
    expect(serializeSearchState(parse(messy))).toBe("lat=-37.767&lng=144.962&surface=grass&amenities=parking,toilets");
  });
});

describe("invalid parameters fall back safely", () => {
  it.each(["0", "51", "abc", "10.5", "1e1", "-5", "", "100"])("radiusKm=%s → the default 10 km (C9)", (value) => {
    expect(parse(`radiusKm=${value}`).filters.radiusKm).toBe(10);
  });

  it("drops unknown enum values to 'any'", () => {
    expect(parse("surface=astroturf&pitchSize=huge&lighting=maybe&access=vip").filters).toEqual(defaultFilters());
  });

  it("keeps the known amenities from a partly bad list, in order, once each", () => {
    expect(parse("amenities=toilets,sauna,toilets,parking").filters.amenities).toEqual(["parking", "toilets"]);
    expect(parse("amenities=,,,").filters.amenities).toEqual([]);
  });

  it.each([
    ["only lat", "lat=-37.8"],
    ["only lng", "lng=144.9"],
    ["lat out of range", "lat=91&lng=144.9"],
    ["lng out of range", "lat=-37.8&lng=180.5"],
    ["an exponent", "lat=-3.7e1&lng=144.9"],
    ["Infinity", "lat=Infinity&lng=144.9"],
    ["hex", "lat=0x10&lng=144.9"],
    ["whitespace", "lat=%20-37.8&lng=144.9"],
  ])("has no location for %s", (_name, query) => {
    expect(parse(query).location).toBeNull();
  });

  it("ignores a place label without coordinates, and a bad label but not its location", () => {
    expect(parse("place=Brunswick").location).toBeNull();
    const long = "x".repeat(MAX_PLACE_LABEL_LENGTH + 1);
    expect(parse(`lat=-37.8&lng=144.9&place=${long}`).location).toEqual({ lat: -37.8, lng: 144.9, label: null });
    expect(parse("lat=-37.8&lng=144.9&place=a%00b").location?.label).toBeNull();
    expect(parse("lat=-37.8&lng=144.9&place=%20%20").location?.label).toBeNull();
    expect(parse("lat=-37.8&lng=144.9&place=%20St%20%20Kilda%20").location?.label).toBe("St Kilda");
  });

  it("takes the first of a repeated parameter and ignores unknown ones", () => {
    expect(parse("surface=grass&surface=hybrid&fbclid=abc&gclid=1").filters.surface).toBe("grass");
  });

  it("never throws, whatever the values", () => {
    const junk = ["", " ", "%", "null", "undefined", "[]", "{}", "-", ".", "-.", "1.", "💥", "a".repeat(5000)];
    const keys = ["lat", "lng", "place", "radiusKm", "surface", "pitchSize", "lighting", "access", "amenities"];
    for (const key of keys) {
      for (const value of junk) {
        const params = new URLSearchParams([[key, value]]);
        expect(() => parseSearchState(params), `${key}=${value}`).not.toThrow();
      }
    }
  });
});

describe("coordinate rounding (ADR-0005, plan T1)", () => {
  it("rounds a typed place to 3 dp (~110 m)", () => {
    expect(placeLocation(-37.813629, 144.963058, "Melbourne")).toEqual({
      lat: -37.814,
      lng: 144.963,
      label: "Melbourne",
    });
  });

  it("rounds a device fix to 2 dp (~1.1 km), and its URL carries no more", () => {
    const location = deviceLocation(-37.813629, 144.963058, null);
    expect(location).toEqual({ lat: -37.81, lng: 144.96, label: null });
    const url = serializeSearchState({ location, filters: defaultFilters() });
    expect(url).toBe("lat=-37.81&lng=144.96");
    expect(url).not.toMatch(/\d\.\d{3}/);
  });

  it("rounds precise coordinates from a URL to 3 dp", () => {
    expect(parse("lat=-37.8136291234&lng=144.9630581").location).toEqual({ lat: -37.814, lng: 144.963, label: null });
  });

  it("writes -0 as 0", () => {
    expect(serializeSearchState({ location: placeLocation(-0.0001, -0.0004, null), filters: defaultFilters() })).toBe(
      "lat=0&lng=0",
    );
  });

  it.each([
    [91, 0],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects (%s, %s)", (lat, lng) => {
    expect(placeLocation(lat, lng, null)).toBeNull();
    expect(deviceLocation(lat, lng, null)).toBeNull();
  });
});

describe("apiQueryString", () => {
  it("is null until there is a location", () => {
    expect(apiQueryString({ location: null, filters: defaultFilters() })).toBeNull();
  });

  it.each(SAMPLES.filter((s) => s.location !== null).map((s) => [serializeSearchState(s), s] as const))(
    "is the API's canonical form, so it is never redirected: %s",
    (_name, state) => {
      const query = apiQueryString(state) ?? "";
      const parsed = parseSearchQuery(new URLSearchParams(query));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(canonicalQueryString(parsed.query)).toBe(query);
    },
  );

  it("never sends the place label, and passes the page through", () => {
    const query = apiQueryString({ location: brunswick, filters: defaultFilters() }, { limit: 30, cursor: "abc.def" });
    expect(query).toBe("lat=-37.767&lng=144.962&limit=30&cursor=abc.def");
    expect(query).not.toContain("Brunswick");
  });
});

describe("draft vs applied filters", () => {
  const applied = { ...defaultFilters(), surface: "grass" as const };
  const opened = () => filterDialogReducer(initialFilterDialogState(applied), { type: "open" });

  it("opens with a draft equal to the applied filters", () => {
    const state = opened();
    expect(state.draft).toEqual(applied);
    expect(state.draft).not.toBe(state.applied);
  });

  it("edits only the draft until apply", () => {
    let state = opened();
    state = filterDialogReducer(state, { type: "setChoice", field: "surface", value: "synthetic" });
    state = filterDialogReducer(state, { type: "setChoice", field: "lighting", value: true });
    state = filterDialogReducer(state, { type: "setRadius", radiusKm: 25 });
    state = filterDialogReducer(state, { type: "toggleAmenity", amenity: "toilets" });
    expect(state.applied).toEqual(applied);
    expect(state.draft).toEqual({
      ...applied,
      surface: "synthetic",
      lighting: true,
      radiusKm: 25,
      amenities: ["toilets"],
    });
  });

  it("discards the draft on cancel, and the next open starts from the applied filters again", () => {
    let state = opened();
    state = filterDialogReducer(state, { type: "setChoice", field: "access", value: "public" });
    state = filterDialogReducer(state, { type: "cancel" });
    expect(state).toEqual({ applied, draft: null });
    expect(filterDialogReducer(state, { type: "open" }).draft).toEqual(applied);
  });

  it("applies the draft atomically and closes", () => {
    let state = opened();
    state = filterDialogReducer(state, { type: "setChoice", field: "pitchSize", value: "full" });
    state = filterDialogReducer(state, { type: "apply" });
    expect(state).toEqual({ applied: { ...applied, pitchSize: "full" }, draft: null });
  });

  it("clear all resets the draft, not the results", () => {
    let state = opened();
    state = filterDialogReducer(state, { type: "setRadius", radiusKm: 40 });
    state = filterDialogReducer(state, { type: "clearAll" });
    expect(state.draft).toEqual(defaultFilters());
    expect(state.applied).toEqual(applied);
  });

  it("toggles amenities on and off, keeping the canonical order", () => {
    let state = opened();
    for (const amenity of ["toilets", "parking", "cafe"] as const) {
      state = filterDialogReducer(state, { type: "toggleAmenity", amenity });
    }
    expect(state.draft?.amenities).toEqual(["parking", "toilets", "cafe"]);
    state = filterDialogReducer(state, { type: "toggleAmenity", amenity: "toilets" });
    expect(state.draft?.amenities).toEqual(["parking", "cafe"]);
  });

  it.each([
    [0, 1],
    [-3, 1],
    [99, 50],
    [12.6, 13],
    [Number.NaN, 10],
  ])("clamps radius %s to %s", (input, expected) => {
    expect(filterDialogReducer(opened(), { type: "setRadius", radiusKm: input }).draft?.radiusKm).toBe(expected);
  });

  it("ignores edits, cancel and apply while closed", () => {
    const closed = initialFilterDialogState(applied);
    const actions = [
      { type: "setRadius", radiusKm: 5 },
      { type: "setChoice", field: "surface", value: null },
      { type: "toggleAmenity", amenity: "cafe" },
      { type: "clearAll" },
      { type: "cancel" },
      { type: "apply" },
    ] as const;
    for (const action of actions) expect(filterDialogReducer(closed, action), action.type).toBe(closed);
  });

  it("adopts the URL's filters on back/forward and drops an open draft", () => {
    let state: FilterDialogState = filterDialogReducer(opened(), { type: "setRadius", radiusKm: 5 });
    const fromUrl = { ...defaultFilters(), access: "members_only" as const };
    state = filterDialogReducer(state, { type: "syncFromUrl", filters: fromUrl });
    expect(state).toEqual({ applied: fromUrl, draft: null });
  });

  it("never shares arrays between draft, applied and the caller's filters", () => {
    const callers = { ...defaultFilters(), amenities: ["parking" as const] };
    const state = filterDialogReducer(initialFilterDialogState(callers), { type: "open" });
    state.draft?.amenities.push("cafe");
    expect(state.applied.amenities).toEqual(["parking"]);
    expect(callers.amenities).toEqual(["parking"]);
    expect(defaultFilters()).not.toBe(defaultFilters());
  });
});

describe("activeFilterCount", () => {
  it("is 0 for the defaults and counts radius, each choice and each facility", () => {
    expect(activeFilterCount(defaultFilters())).toBe(0);
    expect(activeFilterCount({ ...defaultFilters(), radiusKm: 10 })).toBe(0);
    expect(activeFilterCount({ ...defaultFilters(), radiusKm: 25 })).toBe(1);
    expect(activeFilterCount({ ...defaultFilters(), lighting: false })).toBe(1);
    expect(
      activeFilterCount({
        radiusKm: 1,
        surface: "grass",
        pitchSize: "full",
        lighting: true,
        access: "public",
        amenities: ["parking", "toilets"],
      }),
    ).toBe(7);
  });
});
