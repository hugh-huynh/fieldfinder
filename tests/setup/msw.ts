import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "../msw/server";

// Unhandled requests fail the test: tests must never depend on live providers.
// msw 3 renamed `onUnhandledRequest` to `onUnhandledFrame` and defaults to "warn", so this must stay explicit.
beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
