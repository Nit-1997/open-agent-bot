import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readEnvFiles } from "./env.ts";
import { ALLOW_LIVE_ENV, allowLive, appOrigin, liveOriginProblem, previewOriginProblem } from "./origin.ts";

const E2E = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYWRIGHT = createRequire(import.meta.url).resolve("@playwright/test/cli");
const LIVE = "https://app.localhost";
const PREVIEW = "http://localhost:18300";
const PROJECTS = ["desktop", "tablet", "phone", "smoke", "preview-m1"];

describe("previewOriginProblem", () => {
  for (const ok of ["http://localhost:18000", "http://localhost:18300", "http://127.0.0.1:19999", "http://127.0.0.1:18443"]) {
    it(`accepts ${ok}`, () => assert.equal(previewOriginProblem(ok), undefined));
  }
  for (const bad of [
    undefined,
    "",
    LIVE,
    "https://app.localhost:18300",
    "https://localhost:18300",
    "http://localhost",
    "http://localhost:80",
    "http://localhost:8000",
    "http://localhost:17999",
    "http://localhost:20000",
    "http://127.0.0.2:18300",
    "http://app.localhost:18300",
    "http://localhost.example.com:18300",
    "http://user@localhost:18300",
    "http://localhost:18300/",
    "http://localhost:18300/app",
    "http://localhost:18300?x=1",
    "http://[::1]:18300",
    "not a url",
  ]) {
    it(`refuses ${JSON.stringify(bad)}`, () => assert.match(previewOriginProblem(bad) ?? "", /APP_ORIGIN/));
  }
});

describe("liveOriginProblem", () => {
  for (const ok of [LIVE, "https://app.example.com", PREVIEW]) {
    it(`accepts ${ok}`, () => assert.equal(liveOriginProblem(ok), undefined));
  }
  for (const bad of [undefined, "", "app.localhost", "ftp://app.localhost", "https://app.localhost/", "https://app.localhost/x", "not a url"]) {
    it(`refuses ${JSON.stringify(bad)}`, () => assert.match(liveOriginProblem(bad) ?? "", /APP_ORIGIN/));
  }
});

describe("allowLive", () => {
  it("is on only for E2E_ALLOW_LIVE=1", () => {
    assert.equal(allowLive({ [ALLOW_LIVE_ENV]: "1" }), true);
    for (const value of [undefined, "", "0", "true", "yes", " 1", "1 "]) assert.equal(allowLive({ [ALLOW_LIVE_ENV]: value }), false, String(value));
  });
});

describe("appOrigin", () => {
  it("accepts an explicit preview origin", () => {
    assert.equal(appOrigin({ explicit: PREVIEW, allowLive: false }), PREVIEW);
    assert.equal(appOrigin({ explicit: ` ${PREVIEW} `, allowLive: false }), PREVIEW);
  });
  it("requires an explicit origin, even with the live opt-in", () => {
    for (const explicit of [undefined, "", " "]) {
      assert.throws(() => appOrigin({ explicit, allowLive: false }), /APP_ORIGIN is not set/);
      assert.throws(() => appOrigin({ explicit, allowLive: true }), /APP_ORIGIN is not set/);
    }
  });
  it("refuses the live origin without the opt-in and names the opt-in", () => {
    assert.throws(() => appOrigin({ explicit: LIVE, allowLive: false }), /must be http:\/\/localhost.*E2E_ALLOW_LIVE=1/s);
  });
  it("accepts a live origin with the opt-in, still checking its shape", () => {
    assert.equal(appOrigin({ explicit: LIVE, allowLive: true }), LIVE);
    assert.throws(() => appOrigin({ explicit: `${LIVE}/`, allowLive: true }), /APP_ORIGIN/);
  });
});

describe("env files", () => {
  const dir = mkdtempSync(join(tmpdir(), "oab-e2e-env-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("never supply APP_ORIGIN or the live opt-in", () => {
    const file = join(dir, ".env-e2e");
    writeFileSync(file, `APP_ORIGIN=${LIVE}\nE2E_ALLOW_LIVE=1\nE2E_OPENROUTER_KEY="k"\n`);
    assert.deepEqual(readEnvFiles([file, join(dir, "missing")]), { E2E_OPENROUTER_KEY: "k" });
  });
});

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
  it("the live origin loads only with E2E_ALLOW_LIVE=1", () => {
    assert.equal(list("desktop", LIVE, { [ALLOW_LIVE_ENV]: "1" }).status, 0);
    assert.notEqual(list("desktop", LIVE, { [ALLOW_LIVE_ENV]: "true" }).status, 0);
  });
});
