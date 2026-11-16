import { describe, expect, it } from "vitest";

import { assertPublicMapboxToken } from "./token";

// The build-time guard on NEXT_PUBLIC_MAPBOX_TOKEN (PR 3.4): a secret must stop the build, because
// Next.js inlines the value into browser code before any runtime check could refuse it.

describe("assertPublicMapboxToken", () => {
  it("accepts an unset or blank token (the map is just unavailable)", () => {
    expect(() => {
      assertPublicMapboxToken(undefined);
    }).not.toThrow();
    expect(() => {
      assertPublicMapboxToken("  ");
    }).not.toThrow();
  });

  it("accepts a public token", () => {
    expect(() => {
      assertPublicMapboxToken(" pk.eyJ1IjoiZXhhbXBsZSJ9.abc-DEF_123 ");
    }).not.toThrow();
  });

  it.each(["sk.eyJ1IjoiZXhhbXBsZSJ9.secretpart", "tk.abc", "eyJabc", "pk.has space"])(
    "refuses %s without echoing it",
    (token) => {
      expect(() => {
        assertPublicMapboxToken(token);
      }).toThrow(/NEXT_PUBLIC_MAPBOX_TOKEN must be a public Mapbox token/);
      try {
        assertPublicMapboxToken(token);
      } catch (error) {
        expect((error as Error).message).not.toContain(token);
      }
    },
  );
});
