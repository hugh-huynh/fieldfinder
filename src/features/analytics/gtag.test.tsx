import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyticsActive, measurementId, sendPageView, startAnalytics, stopAnalytics, track } from "./gtag";

// The one module that talks to GA4 (PR 4.1). gtag.js itself never loads in tests: the data layer is
// what it would read, so that's what's checked.

const ID = "G-TEST12345";
const HOME = "https://fieldfinder.example/";
const VENUE = "5eed0000-0000-4000-8000-000000000001";

/** The data layer as plain arrays (gtag pushes Arguments objects). */
function layer(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}
const events = () => layer().filter((entry) => entry[0] === "event");

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("measurementId", () => {
  it("accepts a GA4 measurement id only", () => {
    expect(measurementId(" G-ABC123XYZ9 ")).toBe("G-ABC123XYZ9");
    for (const value of [undefined, "", "UA-1234-1", "G-", "g-abc123", "G-ABC 123", 'G-ABC123"><script>']) {
      expect(measurementId(value)).toBeNull();
    }
  });
});

describe("before analytics starts", () => {
  it("sends nothing and loads nothing", () => {
    expect(track({ name: "view_venue", params: { venue_id: VENUE, source: "list" } })).toBe(false);
    expect(sendPageView(HOME, "FieldFinder")).toBe(false);
    expect(window.dataLayer).toBeUndefined();
    expect(document.querySelector("script[data-ff-gtag]")).toBeNull();
  });
});

describe("startAnalytics", () => {
  it("configures GA4 without automatic page views or ad features, and loads gtag.js once", () => {
    startAnalytics(ID, HOME, "https://www.google.com");
    startAnalytics(ID, HOME, null);
    const configs = layer().filter((entry) => entry[0] === "config");
    expect(configs).toEqual([
      [
        "config",
        ID,
        {
          send_page_view: false,
          page_location: HOME,
          page_referrer: "https://www.google.com",
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          cookie_expires: 34_164_000,
        },
      ],
    ]);
    const scripts = document.querySelectorAll<HTMLScriptElement>("script[data-ff-gtag]");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`);
    expect(scripts[0]?.async).toBe(true);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${ID}`]).toBe(false);
    expect(analyticsActive()).toBe(true);
  });

  it("won't start at a location the guard rejects", () => {
    startAnalytics(ID, "https://fieldfinder.example/?lat=-37.81&lng=144.96", null);
    expect(analyticsActive()).toBe(false);
    expect(document.querySelector("script[data-ff-gtag]")).toBeNull();
  });
});

describe("once started", () => {
  beforeEach(() => {
    startAnalytics(ID, HOME, null);
  });

  it("sends a schema-valid event with the sanitised page location", () => {
    expect(track({ name: "view_venue", params: { venue_id: VENUE, source: "map" } })).toBe(true);
    expect(events()).toEqual([["event", "view_venue", { venue_id: VENUE, source: "map", page_location: HOME }]]);
  });

  it("drops an event that doesn't match its schema, whatever the types said", () => {
    const sneaky = { name: "view_venue", params: { venue_id: VENUE, source: "list", lat: -37.81 } };
    expect(track(sneaky as never)).toBe(false);
    expect(events()).toEqual([]);
  });

  it("sends one page view per call, each referring to the page before", () => {
    expect(sendPageView(HOME, "FieldFinder")).toBe(true);
    expect(sendPageView("https://fieldfinder.example/venues/ironbark-park", "Ironbark Park · FieldFinder")).toBe(true);
    expect(events()).toEqual([
      ["event", "page_view", { page_location: HOME, page_title: "FieldFinder" }],
      [
        "event",
        "page_view",
        {
          page_location: "https://fieldfinder.example/venues/ironbark-park",
          page_referrer: HOME,
          page_title: "Ironbark Park · FieldFinder",
        },
      ],
    ]);
    // Later events carry the new page, never the browser's real URL.
    track({ name: "click_directions", params: { venue_id: VENUE } });
    expect(events().at(-1)?.[2]).toMatchObject({ page_location: "https://fieldfinder.example/venues/ironbark-park" });
  });

  it("never puts coordinates in the data layer, even when the browser's URL has them", () => {
    window.history.replaceState(null, "", "/?lat=-37.784&lng=144.968&place=12+Smith+St");
    sendPageView(HOME, "FieldFinder");
    track({ name: "nearby_search", params: { result_count: 3, radius_km: 10, filter_count: 0, filter_types: "none" } });
    const sent = JSON.stringify(layer());
    expect(sent).not.toMatch(/lat=|lng=|-37\.7|144\.9|Smith/);
  });

  it("stops at once when consent is withdrawn, and removes GA's cookies", () => {
    document.cookie = "_ga=GA1.1.123; Path=/";
    document.cookie = "_ga_TEST12345=GS1.1.456; Path=/";
    document.cookie = "other=keep; Path=/";
    stopAnalytics(ID);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${ID}`]).toBe(true);
    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toContain("other=keep");
    expect(track({ name: "click_directions", params: { venue_id: VENUE } })).toBe(false);
    expect(sendPageView(HOME, "FieldFinder")).toBe(false);
    document.cookie = "other=; Max-Age=0; Path=/";
  });

  it("starts again after a stop without loading gtag.js twice", () => {
    stopAnalytics(ID);
    startAnalytics(ID, HOME, null);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${ID}`]).toBe(false);
    expect(document.querySelectorAll("script[data-ff-gtag]")).toHaveLength(1);
  });
});
