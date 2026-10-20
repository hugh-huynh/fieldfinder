import { describe, expect, it } from "vitest";

import type { ApiErrorBody } from "@/lib/api/errors";

import { GET as getPitch } from "./pitches/[pitchSlug]/route";
import { GET as getVenue } from "./route";

// Path validation runs before the database is touched, so these need no DB (PR 2.8).
// Behaviour against real data is in tests/integration/venue-detail.test.ts.

const request = new Request("https://ff.test/api/venues/x");

async function expect400(res: Response, fields: string): Promise<void> {
  expect(res.status).toBe(400);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const text = await res.text();
  expect(JSON.parse(text) as ApiErrorBody).toMatchObject({
    code: "invalid_request",
    message: `Invalid request parameters: ${fields}`,
  });
  // The submitted value is never echoed.
  expect(text).not.toContain("Not A Slug");
}

describe("GET /api/venues/[venueSlug] — invalid path", () => {
  it.each(["Not A Slug", "../admin", "x".repeat(101)])("%s → 400", async (venueSlug) => {
    await expect400(await getVenue(request, { params: Promise.resolve({ venueSlug }) }), "venueSlug");
  });
});

describe("GET /api/venues/[venueSlug]/pitches/[pitchSlug] — invalid path", () => {
  it("names each invalid segment", async () => {
    const res = await getPitch(request, {
      params: Promise.resolve({ venueSlug: "ok-venue", pitchSlug: "Not A Slug" }),
    });
    await expect400(res, "pitchSlug");

    const both = await getPitch(request, { params: Promise.resolve({ venueSlug: "Not A Slug", pitchSlug: "" }) });
    await expect400(both, "pitchSlug, venueSlug");
  });
});
