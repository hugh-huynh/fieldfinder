import { describe, expect, it } from "vitest";

import { sanitisePageLocation, sanitiseReferrer } from "./page-location";

// What GA4 is told about the page (ADR-0005, PR 4.1): never the searched coordinates or the typed
// place, which can be a street address.

const ORIGIN = "https://fieldfinder.example";

describe("sanitisePageLocation", () => {
  it("drops the coordinates and the place from a search, keeping its filters in canonical form", () => {
    expect(
      sanitisePageLocation(
        `${ORIGIN}/?lat=-37.784&lng=144.968&place=12+Smith+St%2C+Fitzroy&radiusKm=5&lighting=yes&surface=grass`,
      ),
    ).toBe(`${ORIGIN}/?radiusKm=5&surface=grass&lighting=yes`);
  });

  it("gives a plain search page as /", () => {
    expect(sanitisePageLocation(`${ORIGIN}/?lat=-37.78&lng=144.96`)).toBe(`${ORIGIN}/`);
    expect(sanitisePageLocation(`${ORIGIN}/`)).toBe(`${ORIGIN}/`);
  });

  it("drops anything it doesn't know, including a fragment and repeated or invalid filters", () => {
    expect(sanitisePageLocation(`${ORIGIN}/?utm_source=x&email=a%40b.co&surface=moon&radiusKm=500#lat=-37.8`)).toBe(
      `${ORIGIN}/`,
    );
  });

  it("keeps only the path of any other page", () => {
    expect(sanitisePageLocation(`${ORIGIN}/venues/ironbark-park?lat=-37.8&from=search#photos`)).toBe(
      `${ORIGIN}/venues/ironbark-park`,
    );
    expect(sanitisePageLocation(`${ORIGIN}/privacy`)).toBe(`${ORIGIN}/privacy`);
  });

  it("drops credentials in the URL", () => {
    expect(sanitisePageLocation("https://user:pass@fieldfinder.example/terms")).toBe(`${ORIGIN}/terms`);
  });

  it("refuses anything that isn't an http(s) URL", () => {
    expect(sanitisePageLocation("not a url")).toBeNull();
    expect(sanitisePageLocation("javascript:alert(1)")).toBeNull();
  });
});

describe("sanitiseReferrer", () => {
  it("cuts another site's referrer to its origin", () => {
    expect(sanitiseReferrer("https://www.google.com/search?q=soccer+fields+near+12+Smith+St", ORIGIN)).toBe(
      "https://www.google.com",
    );
  });

  it("sanitises a referrer from this site like a page location", () => {
    expect(sanitiseReferrer(`${ORIGIN}/?lat=-37.8&lng=144.9&place=Home&radiusKm=3`, ORIGIN)).toBe(
      `${ORIGIN}/?radiusKm=3`,
    );
  });

  it("gives nothing for no referrer or one that isn't a web page", () => {
    expect(sanitiseReferrer("", ORIGIN)).toBeNull();
    expect(sanitiseReferrer("android-app://com.example", ORIGIN)).toBeNull();
  });
});
