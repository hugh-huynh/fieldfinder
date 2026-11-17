import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReverseResponse } from "@/features/locations/reverse";
import type { ApiErrorBody } from "@/lib/api/errors";

import { MAPBOX_REVERSE, mapboxReverse } from "../../../../../tests/msw/mapbox";
import { server } from "../../../../../tests/msw/server";

import { GET } from "./route";

// GET /api/locations/reverse against a mocked Mapbox (PR 3.9). No live provider in tests (spec §9).
// The position must only ever leave the server rounded to 2 dp, and never appear in logs (ADR-0005).

const TOKEN = "pk.test-only-not-a-real-token-0123456789";

const call = (query: string) =>
  GET(new Request(`https://ff.test/api/locations/reverse?${query}`), { params: Promise.resolve({}) });

function consoleLines(): string[] {
  const lines: string[] = [];
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  }
  return lines;
}

beforeEach(() => {
  vi.stubEnv("MAPBOX_GEOCODING_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/locations/reverse — success", () => {
  it("returns the locality there, never cached", async () => {
    const mapbox = mapboxReverse();
    server.use(mapbox.handler);
    const res = await call("lat=-37.80&lng=144.97");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()) as ReverseResponse).toEqual({
      place: { name: "Carlton", label: "Carlton, Victoria 3053, Australia" },
    });
  });

  it("sends only 2 dp to Mapbox, whatever the client sent, Australia-only, localities only", async () => {
    const mapbox = mapboxReverse();
    server.use(mapbox.handler);
    await call("lat=-37.812345&lng=144.966789");
    expect(mapbox.requests).toHaveLength(1);
    expect(Object.fromEntries(mapbox.requests[0]?.searchParams ?? [])).toEqual({
      latitude: "-37.81",
      longitude: "144.97",
      country: "au",
      types: "locality,place",
      language: "en",
      access_token: TOKEN,
    });
  });

  it("says there's no place when Mapbox has none (outside Australia, at sea)", async () => {
    server.use(mapboxReverse(() => HttpResponse.json({ type: "FeatureCollection", features: [] })).handler);
    const res = await call("lat=-38.50&lng=146.00");
    expect((await res.json()) as ReverseResponse).toEqual({ place: null });
  });

  it("skips a malformed result and takes the next one", async () => {
    server.use(
      mapboxReverse(() =>
        HttpResponse.json({
          features: [
            { properties: { feature_type: "address", name: "1 Example St" } },
            { properties: { feature_type: "place", name: "Melbourne" } },
          ],
        }),
      ).handler,
    );
    expect((await (await call("lat=-37.81&lng=144.96")).json()) as ReverseResponse).toEqual({
      place: { name: "Melbourne", label: "Melbourne" },
    });
  });
});

describe("GET /api/locations/reverse — bad requests (400, Mapbox not called)", () => {
  it.each([
    ["no parameters", ""],
    ["only lat", "lat=-37.81"],
    ["latitude out of range", "lat=-91&lng=144.96"],
    ["longitude out of range", "lat=-37.81&lng=181"],
    ["not a number", "lat=abc&lng=144.96"],
    ["exponent notation", "lat=-3.7e1&lng=144.96"],
    ["too precise", "lat=-37.8123456&lng=144.96"],
    ["an unknown parameter", "lat=-37.81&lng=144.96&q=x"],
    ["a repeated parameter", "lat=-37.81&lat=-37.82&lng=144.96"],
  ])("%s", async (_, query) => {
    const mapbox = mapboxReverse();
    server.use(mapbox.handler);
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).code).toBe("invalid_request");
    expect(mapbox.requests).toHaveLength(0);
  });
});

describe("GET /api/locations/reverse — Mapbox trouble (503), position and token never logged", () => {
  it.each([
    ["a 500", () => new HttpResponse(null, { status: 500 })],
    ["a 401 (bad token)", () => new HttpResponse(null, { status: 401 })],
    ["invalid JSON", () => new HttpResponse("not json", { headers: { "content-type": "application/json" } })],
    ["an unexpected shape", () => HttpResponse.json({ nope: true })],
    ["a network failure", () => HttpResponse.error()],
  ])("%s", async (_, reply) => {
    const lines = consoleLines();
    server.use(http.get(MAPBOX_REVERSE, reply));
    const res = await call("lat=-37.81&lng=144.97");
    expect(res.status).toBe(503);
    expect(((await res.json()) as ApiErrorBody).code).toBe("unavailable");
    const logged = lines.join("\n");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("37.81");
    expect(logged).not.toContain("144.97");
  });

  it("no token configured: 503 without calling Mapbox", async () => {
    consoleLines();
    vi.stubEnv("MAPBOX_GEOCODING_TOKEN", undefined);
    const mapbox = mapboxReverse();
    server.use(mapbox.handler);
    const res = await call("lat=-37.81&lng=144.97");
    expect(res.status).toBe(503);
    expect(mapbox.requests).toHaveLength(0);
  });
});
