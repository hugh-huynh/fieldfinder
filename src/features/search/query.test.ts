import { describe, expect, it } from "vitest";

import { canonicalQueryString, canonicalSearchKey, parseSearchQuery, type SearchQuery } from "./query";

const parse = (qs: string) => parseSearchQuery(new URLSearchParams(qs));

function ok(qs: string): SearchQuery {
  const result = parse(qs);
  if (!result.ok) throw new Error(`expected ok, got invalid: ${result.fields.join(",")}`);
  return result.query;
}

function invalid(qs: string): string[] {
  const result = parse(qs);
  if (result.ok) throw new Error(`expected invalid: ${qs}`);
  return result.fields.sort();
}

const CENTRE = "lat=-37.8136&lng=144.9631";

describe("parseSearchQuery", () => {
  it("applies defaults: 10 km radius, 20 results, no filters", () => {
    expect(ok(CENTRE)).toEqual({
      lat: -37.814,
      lng: 144.963,
      radiusKm: 10,
      surface: null,
      pitchSize: null,
      lighting: null,
      access: null,
      amenities: [],
      limit: 20,
      cursor: null,
    });
  });

  it("parses every filter", () => {
    expect(
      ok(`${CENTRE}&radiusKm=50&surface=synthetic&pitchSize=small_sided&lighting=no&access=members_only&limit=30`),
    ).toMatchObject({
      radiusKm: 50,
      surface: "synthetic",
      pitchSize: "small_sided",
      lighting: false,
      access: "members_only",
      limit: 30,
    });
    expect(ok(`${CENTRE}&lighting=yes`).lighting).toBe(true);
  });

  it("rounds coordinates to 3 decimals (ADR-0005) and normalises -0", () => {
    expect(ok("lat=-37.81364999&lng=144.96359").lat).toBe(-37.814);
    expect(ok("lat=-37.81364999&lng=144.96359").lng).toBe(144.964);
    expect(Object.is(ok("lat=-0.0001&lng=0").lat, 0)).toBe(true);
  });

  it("puts amenities in one canonical order without duplicates", () => {
    expect(ok(`${CENTRE}&amenities=toilets,parking,toilets`).amenities).toEqual(["parking", "toilets"]);
  });

  it.each([
    ["radius above 50 km", `${CENTRE}&radiusKm=51`, ["radiusKm"]],
    ["radius below 1 km", `${CENTRE}&radiusKm=0`, ["radiusKm"]],
    ["fractional radius", `${CENTRE}&radiusKm=2.5`, ["radiusKm"]],
    ["limit above 30", `${CENTRE}&limit=31`, ["limit"]],
    ["limit 0", `${CENTRE}&limit=0`, ["limit"]],
    ["missing lat", "lng=144.96", ["lat"]],
    ["missing both", "", ["lat", "lng"]],
    ["lat out of range", "lat=91&lng=144.96", ["lat"]],
    ["lng out of range", "lat=-37.8&lng=-180.5", ["lng"]],
    ["exponent notation", "lat=-3.78e1&lng=144.96", ["lat"]],
    ["hex", "lat=0x10&lng=144.96", ["lat"]],
    ["whitespace", "lat= -37.8&lng=144.96", ["lat"]],
    ["NaN", "lat=NaN&lng=144.96", ["lat"]],
    ["Infinity", "lat=-37.8&lng=Infinity", ["lng"]],
    ["unknown surface", `${CENTRE}&surface=clay`, ["surface"]],
    ["lighting as boolean word", `${CENTRE}&lighting=true`, ["lighting"]],
    ["unknown amenity", `${CENTRE}&amenities=parking,sauna`, ["amenities"]],
    ["empty amenities", `${CENTRE}&amenities=`, ["amenities"]],
    ["empty filter value", `${CENTRE}&surface=`, ["surface"]],
    ["unknown parameter", `${CENTRE}&sort=distance`, ["sort"]],
    ["repeated parameter", `${CENTRE}&surface=grass&surface=synthetic`, ["surface"]],
    ["cursor with bad characters", `${CENTRE}&cursor=abc%20def`, ["cursor"]],
    ["oversized cursor", `${CENTRE}&cursor=${"a".repeat(513)}`, ["cursor"]],
  ])("rejects %s", (_name, qs, fields) => {
    expect(invalid(qs)).toEqual(fields);
  });
});

describe("canonicalSearchKey", () => {
  it("is equal for equivalent spellings of one search", () => {
    const a = ok("lat=-37.8136&lng=144.9631&amenities=toilets,parking&limit=5");
    const b = ok("amenities=parking,toilets&lng=144.96312&lat=-37.81361&limit=30&radiusKm=10");
    expect(canonicalSearchKey(a)).toBe(canonicalSearchKey(b));
  });

  it.each([
    ["centre", "lat=-37.9&lng=144.9631"],
    ["radius", `${CENTRE}&radiusKm=11`],
    ["surface", `${CENTRE}&surface=grass`],
    ["pitch size", `${CENTRE}&pitchSize=full`],
    ["lighting", `${CENTRE}&lighting=no`],
    ["access", `${CENTRE}&access=public`],
    ["amenities", `${CENTRE}&amenities=cafe`],
  ])("changes when the %s changes", (_name, qs) => {
    expect(canonicalSearchKey(ok(qs))).not.toBe(canonicalSearchKey(ok(CENTRE)));
  });
});

describe("canonicalQueryString", () => {
  it.each([
    "lat=-37.8136&lng=144.9631",
    "lat=0&lng=-0.0004&radiusKm=1&limit=1",
    "lat=90&lng=-180&radiusKm=50&surface=hybrid&pitchSize=training&lighting=no&access=public&amenities=cafe,parking&limit=30&cursor=abc.def",
  ])("is a fixed point: parsing it gives the same search and the same string (%s)", (qs) => {
    const canonical = canonicalQueryString(ok(qs));
    expect(ok(canonical)).toEqual(ok(qs));
    expect(canonicalQueryString(ok(canonical))).toBe(canonical);
  });

  it("omits defaults and uses fixed parameter order", () => {
    expect(canonicalQueryString(ok("limit=20&radiusKm=10&lng=144.963&lat=-37.814&lighting=yes"))).toBe(
      "lat=-37.814&lng=144.963&lighting=yes",
    );
  });
});
