import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SuggestResponse } from "@/features/locations/suggest";
import type { ApiErrorBody } from "@/lib/api/errors";

import { MAPBOX_FORWARD, mapboxForward, sampleFeatures } from "../../../../../tests/msw/mapbox";
import { server } from "../../../../../tests/msw/server";

import { GET } from "./route";

// GET /api/locations/suggest against a mocked Mapbox (PR 2.13). No live provider in tests (spec §9).

const TOKEN = "pk.test-only-not-a-real-token-0123456789";

const call = (query: string) =>
  GET(new Request(`https://ff.test/api/locations/suggest?${query}`), { params: Promise.resolve({}) });

/** Every line any console method prints during the test. */
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

describe("GET /api/locations/suggest — success", () => {
  it("returns up to 5 Australian suggestions with rounded coordinates, never cached", async () => {
    const mapbox = mapboxForward();
    server.use(mapbox.handler);

    const res = await call("q=Brunswick");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as SuggestResponse).suggestions).toEqual([
      {
        id: sampleFeatures[0]?.properties.mapbox_id,
        name: "Brunswick",
        label: "Brunswick, Victoria 3056, Australia",
        type: "locality",
        latitude: -37.767,
        longitude: 144.96,
      },
      {
        id: sampleFeatures[1]?.properties.mapbox_id,
        name: "1 Example Street",
        label: "1 Example Street, Brunswick West Victoria 3055, Australia",
        type: "address",
        latitude: -37.756,
        longitude: 144.954,
      },
    ]);
  });

  it("sends a bounded, Australia-only query biased to Melbourne, with the token server-side", async () => {
    const mapbox = mapboxForward();
    server.use(mapbox.handler);
    await call("q=%20%20Brunswick%20%20%20East%20");

    expect(mapbox.requests).toHaveLength(1);
    const sent = Object.fromEntries(mapbox.requests[0]?.searchParams ?? []);
    expect(sent).toEqual({
      q: "Brunswick East", // trimmed, whitespace collapsed
      country: "au",
      proximity: "144.963,-37.814",
      types: "postcode,place,locality,neighborhood,address",
      autocomplete: "true",
      limit: "5",
      language: "en",
      access_token: TOKEN,
    });
  });

  it("skips a malformed result instead of failing the whole response", async () => {
    server.use(
      mapboxForward(() =>
        HttpResponse.json({ features: [{ properties: { name: "no id or coordinates" } }, sampleFeatures[0]] }),
      ).handler,
    );
    const body = (await (await call("q=Bruns")).json()) as SuggestResponse;
    expect(body.suggestions.map((s) => s.name)).toEqual(["Brunswick"]);
  });
});

describe("GET /api/locations/suggest — invalid input → 400, Mapbox never called", () => {
  it.each([
    ["missing q", ""],
    ["one character", "q=B"],
    ["only spaces", "q=%20%20%20"],
    ["81 characters", `q=${"a".repeat(81)}`],
    ["a control character", "q=Bruns%00wick"],
    ["markup", "q=%3Cscript%3E"],
    ["an emoji", "q=%F0%9F%8F%9F%EF%B8%8F"],
    ["an unknown parameter", "q=Brunswick&limit=50"],
    ["a repeated q", "q=Brunswick&q=Carlton"],
  ])("%s", async (_name, query) => {
    const mapbox = mapboxForward();
    server.use(mapbox.handler);
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).code).toBe("invalid_request");
    expect(mapbox.requests).toHaveLength(0);
  });

  it("accepts real-world names: accents, apostrophes, hyphens, unit numbers", async () => {
    server.use(mapboxForward().handler);
    for (const q of ["Moorabbin", "St Kilda", "Box Hill-North", "O'Connor", "Côte", "3/15 Example St", "3056"]) {
      expect((await call(`q=${encodeURIComponent(q)}`)).status, q).toBe(200);
    }
  });
});

describe("GET /api/locations/suggest — upstream problems → 503, the token never leaks", () => {
  it.each([
    ["Mapbox rejects the token", () => new HttpResponse(null, { status: 401 })],
    ["Mapbox errors", () => new HttpResponse(null, { status: 500 })],
    ["Mapbox rate-limits us", () => new HttpResponse(null, { status: 429 })],
    ["the body isn't JSON", () => new HttpResponse("<html>", { headers: { "content-type": "text/html" } })],
    ["the body has an unexpected shape", () => HttpResponse.json({ unexpected: true })],
  ])("%s", async (_name, reply) => {
    const lines = consoleLines();
    server.use(mapboxForward(reply).handler);
    const res = await call("q=Brunswick");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect((JSON.parse(text) as ApiErrorBody).code).toBe("unavailable");
    for (const output of [text, ...lines]) expect(output).not.toContain(TOKEN);
  });

  it("a network failure", async () => {
    const lines = consoleLines();
    server.use(http.get(MAPBOX_FORWARD, () => HttpResponse.error()));
    const res = await call("q=Brunswick");
    expect(res.status).toBe(503);
    for (const output of lines) expect(output).not.toContain(TOKEN);
  });

  it("no token configured: 503 without calling Mapbox", async () => {
    vi.stubEnv("MAPBOX_GEOCODING_TOKEN", undefined);
    const lines = consoleLines();
    const mapbox = mapboxForward();
    server.use(mapbox.handler);
    expect((await call("q=Brunswick")).status).toBe(503);
    expect(mapbox.requests).toHaveLength(0);
    expect(lines.some((line) => line.includes("locations.suggest_unconfigured"))).toBe(true);
  });
});

describe("suggestLocations — timeout", () => {
  it("turns a slow Mapbox (aborted after 3 s) into a 503", async () => {
    const { suggestLocations } = await import("@/features/locations/suggest");
    const timedOut = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(suggestLocations("Brunswick", { fetch: timedOut as unknown as typeof fetch })).rejects.toMatchObject({
      code: "unavailable",
      status: 503,
    });
  });
});
