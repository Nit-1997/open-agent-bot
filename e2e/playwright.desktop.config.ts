import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./desktop",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results/desktop",
  projects: [
    { name: "desktop-fake", testMatch: /.*\.spec\.ts/, testIgnore: /(real|demo|localBuild)\.spec\.ts/ },
    { name: "desktop-real", testMatch: /(real|localBuild)\.spec\.ts/ },
    { name: "desktop-demo", testMatch: /demo\.spec\.ts/ },
  ],
});
