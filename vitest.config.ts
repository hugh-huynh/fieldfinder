import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { LOCAL_READER_URL, TEST_CURSOR_SECRET } from "./tests/setup/integration-env.ts";

const src = fileURLToPath(new URL("./src", import.meta.url));
// `server-only` throws outside Next's server build; tests load server modules directly.
const serverOnlyStub = fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": src, "server-only": serverOnlyStub },
  },
  test: {
    restoreMocks: true,
    // `pnpm test` runs unit + component; `pnpm test:integration` runs integration (needs the local DB).
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          // MSW in every unit/component file, so no test can reach the real network.
          setupFiles: ["./tests/setup/msw.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "tests/unit/**/*.test.tsx"],
          setupFiles: ["./tests/setup/msw.ts", "./tests/setup/dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // No MSW here: msw 3 intercepts raw TCP sockets and breaks the Postgres protocol (PR 2.6 note).
          // The global setup refuses any database that isn't on localhost.
          globalSetup: ["./tests/setup/integration-db.ts"],
          env: {
            DATABASE_URL_PUBLIC_READER: LOCAL_READER_URL,
            SEARCH_CURSOR_SECRET: TEST_CURSOR_SECRET,
          },
          // One shared database: run files one at a time.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/app/**/layout.tsx"],
      reporter: ["text-summary", "html", "json-summary"],
    },
  },
});
