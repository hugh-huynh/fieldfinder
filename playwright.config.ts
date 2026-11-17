import { defineConfig, devices } from "@playwright/test";

import { LOCAL_MEDIA_PUBLIC_BASE_URL, LOCAL_READER_URL } from "./tests/setup/integration-env";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

// Viewports agreed in the plan (P7): desktop 1440x900, mobile 390x844.
const mobileViewport = { width: 390, height: 844 };

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-AU",
    timezoneId: "Australia/Melbourne",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: mobileViewport },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 15"], viewport: mobileViewport },
    },
  ],
  // When E2E_BASE_URL is set (e.g. a preview deployment), no local server is started.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: isCI ? `pnpm start --port ${PORT}` : `pnpm build && pnpm start --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 180_000,
        // The WebGL-free stand-in map (PR 3.4): no token or network. NEXT_PUBLIC_ values are baked in at
        // build time, so this only takes effect when this command builds (locally).
        // Server-rendered pages (3.10) read the database: always the LOCAL one (these override
        // .env.local), so E2E never touches a hosted project. Without `pnpm db:start` those pages
        // fail, and only the E2E_DB=1 specs need them.
        env: {
          NEXT_PUBLIC_MAP_ADAPTER: "fake",
          DATABASE_URL_PUBLIC_READER: LOCAL_READER_URL,
          MEDIA_PUBLIC_BASE_URL: LOCAL_MEDIA_PUBLIC_BASE_URL,
        },
      },
});
