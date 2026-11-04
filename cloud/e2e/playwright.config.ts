import { defineConfig, devices } from "@playwright/test";
import { allowLive, appOrigin } from "../../e2e/support/origin";
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
    baseURL: appOrigin({ explicit: process.env.APP_ORIGIN, allowLive: allowLive(process.env) }),
    ignoreHTTPSErrors: true,
    storageState: storageFor(DEMO_USER),
    launchOptions: { slowMo: Number(process.env.DEMO_SLOWMO ?? 0) },
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "desktop",
      testMatch: /app-shell\.demo\.spec\.ts/,
      grep: /@desktop/,
      use: { viewport: desktop, video: { mode: "on", size: desktop } },
    },
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
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: phone,
        isMobile: true,
        hasTouch: true,
        video: { mode: "on", size: phone },
      },
    },
    { name: "smoke", testMatch: /preview-smoke\.spec\.ts/, use: { viewport: desktop, video: { mode: "on", size: desktop } } },
    { name: "compat", testMatch: /compat-old-web\.spec\.ts/, use: { viewport: desktop, video: { mode: "on", size: desktop } } },
    { name: "preview-m1", testMatch: /preview-m1\.spec\.ts/, use: { viewport: desktop, video: { mode: "on", size: desktop } } },
    { name: "preview-m2", testMatch: /preview-m2\.spec\.ts/, use: { viewport: desktop, video: { mode: "on", size: desktop } } },
  ],
});
