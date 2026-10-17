import { describe, expect, it } from "vitest";

import { createLogger, redact, REDACTED, scrubString, type LogLevel } from "./log";

function capture(minLevel: LogLevel = "debug") {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = createLogger(
    (level, line) => lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> }),
    minLevel,
  );
  return { logger, lines };
}

describe("redact", () => {
  it("drops coordinate, credential and header keys at any depth", () => {
    const out = redact({
      lat: -37.8136,
      lng: 144.9631,
      query: { latitude: -37.8, longitude: 144.9, radiusKm: 10 },
      headers: { authorization: "Bearer abc", cookie: "a=b", "x-forwarded-for": "203.0.113.9", accept: "json" },
      adminToken: "ffa_123",
      DATABASE_URL_PUBLIC_READER: "postgres://u:p@h/db",
      nested: [{ password: "hunter2", ok: 1 }],
    });
    expect(out).toEqual({
      lat: REDACTED,
      lng: REDACTED,
      query: { latitude: REDACTED, longitude: REDACTED, radiusKm: 10 },
      headers: { authorization: REDACTED, cookie: REDACTED, "x-forwarded-for": REDACTED, accept: "json" },
      adminToken: REDACTED,
      DATABASE_URL_PUBLIC_READER: REDACTED,
      nested: [{ password: REDACTED, ok: 1 }],
    });
  });

  it("logs only safe Error fields, never Postgres detail, query or parameters", () => {
    const pgError = Object.assign(new Error('new row for relation "venues" violates check constraint'), {
      code: "23514",
      detail: "Failing row contains (secret-row-data)",
      query: "insert into venues ...",
      parameters: ["-37.8136", "144.9631"],
    });
    const out = redact({ error: pgError }) as { error: Record<string, unknown> };
    expect(Object.keys(out.error).sort()).toEqual(["code", "message", "name", "stack"]);
    expect(JSON.stringify(out)).not.toMatch(/secret-row-data|insert into|144\.9631/);
  });

  it("survives cycles, bigints, dates and deep nesting", () => {
    const a: Record<string, unknown> = { n: 1n, when: new Date("2026-10-16T00:00:00Z") };
    a.self = a;
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20; i++) deep = deep.child = {} as Record<string, unknown>;
    expect(redact(a)).toEqual({ n: "1", when: "2026-10-16T00:00:00.000Z", self: "[circular]" });
    expect(JSON.stringify(redact(root))).toContain("[truncated]");
  });
});

describe("scrubString", () => {
  it.each([
    ["/api/venues?lat=-37.8136&lng=144.9631&radiusKm=10", `/api/venues?lat=${REDACTED}&lng=${REDACTED}&radiusKm=10`],
    ["https://x.test/cb?token=abc123&ok=1", `https://x.test/cb?token=${REDACTED}&ok=1`],
    ["Authorization: Bearer eyJhbGciOi.abc.def", `Authorization: Bearer ${REDACTED}`],
    [
      "connect postgres://ff_public_reader:s3cr3t@db.example:6543/postgres",
      `connect postgres://ff_public_reader:${REDACTED}@db.example:6543/postgres`,
    ],
    ["user near -37.8136, 144.9631 searched", `user near ${REDACTED} searched`],
    // Single coordinates (review finding on #23): labelled, JSON-style and unlabelled.
    ["failed near latitude -37.8136", `failed near latitude ${REDACTED}`],
    ["lng=144.9631 lat: -37.81", `lng=${REDACTED} lat: ${REDACTED}`],
    ['{"lon":144.96,"radiusKm":10}', `{"lon":${REDACTED},"radiusKm":10}`],
    ["moved to -37.81361 (approx)", `moved to ${REDACTED} (approx)`],
  ])("scrubs %s", (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it("leaves ordinary text and small numbers alone", () => {
    expect(scrubString("radius 10 km, page 2, 3.5 stars")).toBe("radius 10 km, page 2, 3.5 stars");
    const ordinary = "took 12.5 ms, latency 3.2, Playwright 1.63.0, host 203.0.113.9, at 2026-10-16T00:00:00.000Z";
    expect(scrubString(ordinary)).toBe(ordinary);
  });

  it("caps very long strings", () => {
    expect(scrubString("x".repeat(5_000)).length).toBeLessThanOrEqual(2_001);
  });
});

describe("createLogger", () => {
  it("writes one JSON line per event with level, event and timestamp, redacted", () => {
    const { logger, lines } = capture();
    logger.info("search.done", { lat: -37.81, results: 7 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(lines[0]?.entry).toMatchObject({ level: "info", event: "search.done", lat: REDACTED, results: 7 });
    expect(typeof lines[0]?.entry.ts).toBe("string");
  });

  it("doesn't let fields overwrite the envelope", () => {
    const { logger, lines } = capture();
    logger.error("real.event", { event: "forged", level: "info" });
    expect(lines[0]?.entry).toMatchObject({ event: "real.event", level: "error" });
  });

  it("drops events below the minimum level", () => {
    const { logger, lines } = capture("warn");
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    expect(lines.map((l) => l.entry.event)).toEqual(["c"]);
  });
});
