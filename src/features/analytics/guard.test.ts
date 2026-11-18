import { describe, expect, it } from "vitest";

import { checkAnalyticsParams } from "./guard";

// The forbidden-parameter guard (spec §7, PR 4.1): any key or value that could carry a location, a
// person's details or a credential stops the whole event, whatever the event schema allowed.

const rejected = (params: Record<string, unknown>) => {
  const result = checkAnalyticsParams(params);
  return result.ok ? null : result.reason;
};

describe("checkAnalyticsParams", () => {
  it("accepts the parameters FieldFinder sends", () => {
    expect(
      checkAnalyticsParams({
        search_type: "place",
        result_count: 12,
        radius_km: 10,
        filter_count: 2,
        filter_types: "surface,lighting",
        venue_id: "5eed0000-0000-4000-8000-000000000001",
        pitch_id: "5eed0000-0000-4000-8000-000000000002",
        source: "map",
        page_location: "https://fieldfinder.example/?radiusKm=5&surface=grass",
        page_referrer: "https://www.google.com",
        page_title: "Ironbark Park, Fitzroy North · FieldFinder",
        send_page_view: false,
        allow_google_signals: false,
        cookie_expires: 34_164_000,
      }),
    ).toEqual({ ok: true });
  });

  it.each(["lat", "lng", "lon", "latitude", "longitude", "user_lat", "lat_rounded", "coords", "geo", "position"])(
    "rejects a location parameter named %s",
    (key) => {
      expect(rejected({ [key]: 1 })).toBe(`${key}: forbidden parameter name`);
    },
  );

  it.each([
    "email",
    "user_email",
    "e_mail",
    "name",
    "first_name",
    "phone",
    "address",
    "postcode",
    "place",
    "q",
    "query",
  ])("rejects a personal or typed-text parameter named %s", (key) => {
    expect(rejected({ [key]: "x" })).toBe(`${key}: forbidden parameter name`);
  });

  it.each([
    "token",
    "access_token",
    "id_token",
    "api_key",
    "key",
    "secret",
    "password",
    "auth",
    "authorization",
    "cookie",
    "session",
    "ip",
  ])("rejects a credential parameter named %s", (key) => {
    expect(rejected({ [key]: "x" })).toBe(`${key}: forbidden parameter name`);
  });

  it("still checks the values of the names it allows", () => {
    expect(rejected({ venue_id: "me@example.com" })).toBe("venue_id: looks like an email address");
    expect(rejected({ cookie_expires: -37.814 })).toBe("cookie_expires: looks like a coordinate");
  });

  it("checks names case-insensitively", () => {
    expect(rejected({ Latitude: 1 })).toBe("Latitude: forbidden parameter name");
    expect(rejected({ EMAIL: "x" })).toBe("EMAIL: forbidden parameter name");
  });

  it.each([
    ["a coordinate", -37.814, "looks like a coordinate"],
    ["a coordinate as text", "-37.8136", "looks like a coordinate"],
    ["a coordinate pair", "-37.814,144.963", "looks like a coordinate"],
    ["a URL with lat=", "https://fieldfinder.example/?lat=-37.81&lng=144.96", "looks like a coordinate"],
    ["a URL with lat= only", "/?place=x&lat=-37", "looks like a coordinate"],
    ["an email address", "someone@example.com", "looks like an email address"],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig", "looks like a credential"],
    ["a Bearer header", "Bearer abc.def", "looks like a credential"],
    ["a Mapbox token", "pk.not-a-real-token-but-long", "looks like a credential"],
  ])("rejects %s in an allowed-looking value", (_label, value, reason) => {
    expect(rejected({ page_location: value })).toBe(`page_location: ${reason}`);
  });

  it("looks inside nested objects and arrays", () => {
    expect(rejected({ items: [{ venue_id: "a" }, { lat: 1 }] })).toBe("items[1].lat: forbidden parameter name");
    expect(rejected({ context: { note: "me@example.com" } })).toBe("context.note: looks like an email address");
  });

  it("rejects values it can't vouch for", () => {
    expect(rejected({ value: Number.NaN })).toBe("value: looks like a coordinate");
    expect(rejected({ value: () => 1 })).toBe("value: unsupported value");
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 6; i += 1) deep = { child: deep };
    expect(rejected(deep)).toMatch(/nested too deeply/);
  });

  it("never echoes the value in its reason", () => {
    const reason = rejected({ page_location: "someone@example.com" });
    expect(reason).not.toContain("someone");
  });
});
