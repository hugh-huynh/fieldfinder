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
