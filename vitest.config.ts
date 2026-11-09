import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import {
  LOCAL_MEDIA_PUBLIC_BASE_URL,
  LOCAL_READER_URL,
  LOCAL_S3_ENDPOINT,
  LOCAL_WRITER_URL,
  TEST_CURSOR_SECRET,
} from "./tests/setup/integration-env.ts";

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
          setupFiles: ["./tests/setup/integration-storage.ts"],
          env: {
            DATABASE_URL_PUBLIC_READER: LOCAL_READER_URL,
            DATABASE_URL_ADMIN_WRITER: LOCAL_WRITER_URL,
            SUPABASE_S3_ENDPOINT: LOCAL_S3_ENDPOINT,
            // SUPABASE_S3_REGION / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY come from `supabase status`
            // in tests/setup/integration-db.ts, so no storage key is committed.
            MEDIA_PUBLIC_BASE_URL: LOCAL_MEDIA_PUBLIC_BASE_URL,
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
