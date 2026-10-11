import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "../msw/server";

// Unhandled requests fail the test: tests must never depend on live providers.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
