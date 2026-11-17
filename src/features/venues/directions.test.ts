import { describe, expect, it } from "vitest";

import { directionsUrl } from "./directions";

describe("directionsUrl", () => {
  it("is Google Maps' directions URL to the venue's coordinates, and nothing else", () => {
    const url = new URL(directionsUrl(-37.784, 144.972));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ api: "1", destination: "-37.784,144.972" });
  });
});
