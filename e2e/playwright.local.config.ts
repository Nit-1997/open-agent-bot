import { defineConfig } from "@playwright/test";
import { appOrigin } from "./support/origin";

const desktop = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "./local",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: appOrigin({ explicit: process.env.APP_ORIGIN, allowLive: false }),
    viewport: desktop,
    launchOptions: { slowMo: Number(process.env.DEMO_SLOWMO ?? 0) },
    trace: "off",
    screenshot: "off",
  },
  projects: [
    { name: "local", testMatch: /.*\.spec\.ts/, testIgnore: /demo\.spec\.ts/, use: { video: { mode: "on", size: desktop } } },
    { name: "local-demo", testMatch: /demo\.spec\.ts/, use: { video: { mode: "on", size: desktop } } },
  ],
});
