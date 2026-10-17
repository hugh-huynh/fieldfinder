import { describe, expect, it } from "vitest";

import type { ApiErrorBody } from "@/lib/api/errors";

import { GET } from "./route";

// Validation runs before any database or secret is touched, so these need no DB (PR 2.7).
// Behaviour against real data is in tests/integration/venues-search.test.ts.

const call = (qs: string) => GET(new Request(`https://ff.test/api/venues?${qs}`), { params: Promise.resolve({}) });

describe("GET /api/venues — invalid input", () => {
  it.each([
    ["radiusKm=51", "lat=-37.8136&lng=144.9631&radiusKm=51", "radiusKm"],
    ["limit=31", "lat=-37.8136&lng=144.9631&limit=31", "limit"],
    ["missing centre", "radiusKm=5", "lat, lng"],
    ["unknown parameter", "lat=-37.8136&lng=144.9631&page=2", "page"],
    ["repeated parameter", "lat=-37.8136&lat=-37.9&lng=144.9631", "lat"],
  ])("%s → 400 naming only the parameters", async (_name, qs, fields) => {
    const res = await call(qs);
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as ApiErrorBody;
    expect(body).toMatchObject({ code: "invalid_request", message: `Invalid request parameters: ${fields}` });
  });

  it("never echoes submitted values, even hostile parameter names", async () => {
    const res = await call(`lat=-37.81361&lng=999.12345&%3Cscript%3E=1`);
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toMatch(/37\.8136|999\.12345|<script>/);
    expect(text).toContain("Invalid request parameters: lng, script");
  });
});

describe("GET /api/venues — canonical URL", () => {
  // No database is configured in unit tests: a redirect proves the DB was never touched.
  it.each([
    ["extra coordinate precision", "lat=-37.8136&lng=144.9631", "lat=-37.814&lng=144.963"],
    ["padded numbers", "lat=-037.8140&lng=144.963&radiusKm=05&limit=007", "lat=-37.814&lng=144.963&radiusKm=5&limit=7"],
    ["zero spellings", "lat=00.0&lng=-0.0001", "lat=0&lng=0"],
    ["defaults spelled out", "lat=-37.814&lng=144.963&radiusKm=10&limit=20", "lat=-37.814&lng=144.963"],
    ["parameter order", "lng=144.963&surface=grass&lat=-37.814", "lat=-37.814&lng=144.963&surface=grass"],
    [
      "amenity order and encoding",
      "lat=-37.814&lng=144.963&amenities=toilets%2Cparking,toilets",
      "lat=-37.814&lng=144.963&amenities=parking,toilets",
    ],
  ])("%s → 308 to the canonical URL", async (_name, qs, canonical) => {
    const res = await call(qs);
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`/api/venues?${canonical}`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=86400");
  });
});
