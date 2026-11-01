import { defineConfig, devices } from "@playwright/test";
import { env } from "./support/env";
import { DEMO_USER, storageFor } from "./support/users";

const desktop = { width: 1440, height: 900 };
const tablet = { width: 800, height: 1100 };
const phone = { width: 390, height: 844 };

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: env("APP_ORIGIN"),
    ignoreHTTPSErrors: true,
    storageState: storageFor(DEMO_USER),
    trace: "off",
    screenshot: "off",
  },
  projects: [
    { name: "desktop", testMatch: /app-shell\.demo\.spec\.ts/, grep: /@desktop/, use: { viewport: desktop, video: { mode: "on", size: desktop } } },
    {
      name: "tablet",
      testMatch: /app-shell\.demo\.spec\.ts/,
      grep: /@tablet/,
      dependencies: ["desktop"],
      use: { viewport: tablet, video: { mode: "on", size: tablet } },
    },
    {
      name: "phone",
      testMatch: /app-shell\.demo\.spec\.ts/,
      grep: /@phone/,
      dependencies: ["tablet"],
      use: { ...devices["iPhone 13"], browserName: "chromium", viewport: phone, isMobile: true, hasTouch: true, video: { mode: "on", size: phone } },
    },
  ],
});
