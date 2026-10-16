import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger, type LogLevel } from "@/lib/log";

import { API_ERRORS, ApiError, errorResponse, REQUEST_ID_HEADER, type ApiErrorBody } from "./errors";
import { apiRoute, parseInput } from "./handler";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function capture() {
  const lines: { level: LogLevel; line: string }[] = [];
  return { logger: createLogger((level, line) => lines.push({ level, line }), "debug"), lines };
}

type Handler = (request: Request, context: { params: Promise<Record<string, never>> }) => Promise<Response>;

const call = (handler: Handler, url = "https://ff.test/api/venues?lat=-37.8136&lng=144.9631") =>
  handler(new Request(url), { params: Promise.resolve({}) });

describe("errorResponse", () => {
  it.each(Object.entries(API_ERRORS))(
    "%s → status %s with exactly code, message, requestId",
    async (code, { status }) => {
      const res = errorResponse(code as keyof typeof API_ERRORS, "req-1");
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-1");
      const body = (await res.json()) as ApiErrorBody;
      expect(Object.keys(body).sort()).toEqual(["code", "message", "requestId"]);
      expect(body).toMatchObject({ code, requestId: "req-1" });
    },
  );
});

describe("apiRoute", () => {
  it("passes successful responses through with a request id and logs without the URL", async () => {
    const { logger, lines } = capture();
    const handler = apiRoute("venues.search", () => Promise.resolve(Response.json({ ok: true })), logger);

    const res = await call(handler);

    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.line).toContain('"route":"venues.search"');
    expect(lines[0]?.line).not.toMatch(/-37\.8136|144\.9631|ff\.test/);
  });

  it("turns an ApiError into its code, public message and extra headers", async () => {
    const { logger, lines } = capture();
    const handler = apiRoute(
      "venues.search",
      () => Promise.reject(new ApiError("rate_limited", undefined, { headers: { "retry-after": "30" } })),
      logger,
    );

    const res = await call(handler);
    const body = (await res.json()) as ApiErrorBody;

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(body).toEqual({
      code: "rate_limited",
      message: API_ERRORS.rate_limited.message,
      requestId: res.headers.get(REQUEST_ID_HEADER),
    });
    expect(lines[0]?.level).toBe("warn");
  });

  it("hides unexpected errors behind a generic 500: no stack, message or SQL reaches the client", async () => {
    const { logger, lines } = capture();
    const handler = apiRoute(
      "venues.detail",
      () =>
        Promise.reject(
          Object.assign(new Error("permission denied for table venues"), {
            detail: "Failing row contains (draft-sentinel)",
            code: "42501",
          }),
        ),
      logger,
    );

    const res = await call(handler);
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      code: "internal",
      message: API_ERRORS.internal.message,
      requestId: res.headers.get(REQUEST_ID_HEADER),
    });
    expect(text).not.toMatch(/stack|venues|permission|draft-sentinel|42501|at /);
    // The server log keeps the error for debugging, but never Postgres `detail` (row data).
    expect(lines[0]?.level).toBe("error");
    expect(lines[0]?.line).toContain("42501");
    expect(lines[0]?.line).not.toContain("draft-sentinel");
  });

  it("issues a fresh request id every time and ignores one supplied by the client", async () => {
    const handler = apiRoute("x", () => Promise.resolve(new Response("ok")), capture().logger);
    const forged = new Request("https://ff.test/api", { headers: { [REQUEST_ID_HEADER]: "forged-request-id" } });
    const a = await handler(forged, { params: Promise.resolve({}) });
    const b = await handler(forged, { params: Promise.resolve({}) });
    expect(a.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
    expect(a.headers.get(REQUEST_ID_HEADER)).not.toBe("forged-request-id");
    expect(a.headers.get(REQUEST_ID_HEADER)).not.toBe(b.headers.get(REQUEST_ID_HEADER));
  });
});

describe("parseInput", () => {
  const schema = z.object({
    radiusKm: z.coerce.number().int().min(1).max(50),
    lat: z.coerce.number().min(-90).max(90),
  });

  it("returns parsed values", () => {
    expect(parseInput(schema, { radiusKm: "10", lat: "-37.81" })).toEqual({ radiusKm: 10, lat: -37.81 });
  });

  it("throws a 400 naming the bad parameters but never echoing their values", () => {
    try {
      parseInput(schema, { radiusKm: "51", lat: "-91.123456" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.publicMessage).toBe("Invalid request parameters: lat, radiusKm");
      expect(apiError.publicMessage).not.toMatch(/51|91\.123456/);
    }
  });

  it("strips unsafe characters from client-chosen keys before echoing them", () => {
    const records = z.record(z.string(), z.number());
    try {
      parseInput(records, { "<script>alert(1)</script>": "x" });
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).publicMessage).toBe("Invalid request parameters: scriptalert1script");
    }
  });
});
