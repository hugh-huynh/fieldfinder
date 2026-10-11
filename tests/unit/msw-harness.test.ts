import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../msw/server";

describe("MSW harness", () => {
  it("serves mocked responses registered by a test", async () => {
    server.use(http.get("https://provider.test/ping", () => HttpResponse.json({ ok: true })));

    const res = await fetch("https://provider.test/ping");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects requests that have no handler instead of reaching the network", async () => {
    await expect(fetch("https://api.mapbox.com/should-not-be-called")).rejects.toThrow();
  });
});
