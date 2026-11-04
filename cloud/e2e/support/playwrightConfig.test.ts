import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ALLOW_LIVE_ENV } from "../../../e2e/support/origin.ts";

const E2E = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYWRIGHT = createRequire(import.meta.url).resolve("@playwright/test/cli");
const LIVE = "https://app.localhost";
const PREVIEW = "http://localhost:18300";
const PROJECTS = ["desktop", "tablet", "phone", "smoke", "preview-m1", "preview-m2"];

describe("playwright config", () => {
  const list = (project: string, origin: string | undefined, extra: NodeJS.ProcessEnv = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.APP_ORIGIN;
    delete env[ALLOW_LIVE_ENV];
    delete env.TEST_WORKER_INDEX;
    if (origin !== undefined) env.APP_ORIGIN = origin;
    const run = spawnSync(process.execPath, [PLAYWRIGHT, "test", `--project=${project}`, "--list"], {
      cwd: E2E,
      env: { ...env, ...extra },
      encoding: "utf8",
    });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  };

  for (const project of PROJECTS) {
    it(`${project} refuses to load without APP_ORIGIN`, () => {
      const run = list(project, undefined);
      assert.notEqual(run.status, 0);
      assert.match(run.output, /APP_ORIGIN is not set/);
    });
    it(`${project} refuses the live origin`, () => {
      const run = list(project, LIVE);
      assert.notEqual(run.status, 0);
      assert.match(run.output, /must be http:\/\/localhost/);
    });
    it(`${project} loads with a preview origin`, () => {
      const run = list(project, PREVIEW);
      assert.equal(run.status, 0, run.output);
    });
  }
  it("a run without --project refuses the live origin", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_ORIGIN: LIVE };
    delete env[ALLOW_LIVE_ENV];
    const run = spawnSync(process.execPath, [PLAYWRIGHT, "test", "--list"], { cwd: E2E, env, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}${run.stderr}`, /must be http:\/\/localhost/);
  });
  it("the auth probes ignore the live opt-in", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_ORIGIN: LIVE, AGENT_ORIGIN: "http://127.0.0.1:18800", [ALLOW_LIVE_ENV]: "1" };
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", resolve(E2E, "scripts/auth-probes.mts")], {
      env,
      encoding: "utf8",
    });
    assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
    assert.match(`${run.stdout}${run.stderr}`, /refusing to probe: APP_ORIGIN must be/);
  });
  it("the live origin loads only with E2E_ALLOW_LIVE=1", () => {
    assert.equal(list("desktop", LIVE, { [ALLOW_LIVE_ENV]: "1" }).status, 0);
    assert.notEqual(list("desktop", LIVE, { [ALLOW_LIVE_ENV]: "true" }).status, 0);
  });
});
