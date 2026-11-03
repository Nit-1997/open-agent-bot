import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { appOrigin, previewOriginProblem, runsPreviewProject } from "./origin.ts";

const E2E = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAYWRIGHT = createRequire(import.meta.url).resolve("@playwright/test/cli");
const LIVE = "https://app.localhost";
const PREVIEW = "http://localhost:18300";

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

describe("runsPreviewProject", () => {
  const cases: Array<[string[], boolean]> = [
    [["test", "--project=smoke"], true],
    [["test", "--project", "preview-m1"], true],
    [["test", "--project=desktop", "--project=smoke"], true],
    [["test", "--project", "desktop", "SMOKE"], true],
    [["test", "--project=*"], true],
    [["test", "--project=preview-*"], true],
    [["test", "--project=Preview-M1"], true],
    [["test"], true],
    [["test", "--project=desktop", "--project=tablet", "--project=phone"], false],
    [["test", "--project", "desktop", "--list"], false],
    [["test", "--project=tab*"], false],
  ];
  for (const [args, expected] of cases) {
    it(`${args.join(" ")} → ${expected}`, () => assert.equal(runsPreviewProject(["node", "playwright", ...args]), expected));
  }
});

describe("appOrigin", () => {
  const argv = (...projects: string[]) => ["node", "playwright", "test", ...projects.map((p) => `--project=${p}`)];

  it("preview projects use the explicit preview origin", () => {
    assert.equal(appOrigin({ argv: argv("smoke"), explicit: PREVIEW, fallback: LIVE, inWorker: false }), PREVIEW);
  });
  it("preview projects never fall back to the env-file origin", () => {
    assert.throws(() => appOrigin({ argv: argv("smoke"), explicit: undefined, fallback: LIVE, inWorker: false }), /APP_ORIGIN is not set/);
    assert.throws(() => appOrigin({ argv: argv("preview-m1"), explicit: " ", fallback: PREVIEW, inWorker: false }), /APP_ORIGIN is not set/);
  });
  it("preview projects refuse the live origin", () => {
    assert.throws(() => appOrigin({ argv: argv("preview-m1"), explicit: LIVE, fallback: LIVE, inWorker: false }), /must be http:\/\/localhost/);
  });
  it("a run without --project includes the preview projects", () => {
    assert.throws(() => appOrigin({ argv: ["node", "playwright", "test"], explicit: LIVE, fallback: LIVE, inWorker: false }), /APP_ORIGIN/);
  });
  it("the demo suite keeps its own explicit origin requirement", () => {
    assert.equal(appOrigin({ argv: argv("desktop", "tablet", "phone"), explicit: undefined, fallback: LIVE, inWorker: false }), LIVE);
    assert.throws(() => appOrigin({ argv: argv("desktop"), explicit: undefined, fallback: "", inWorker: false }), /missing APP_ORIGIN/);
  });
  it("workers reuse the origin the runner already checked", () => {
    assert.equal(appOrigin({ argv: ["node", "worker"], explicit: PREVIEW, fallback: LIVE, inWorker: true }), PREVIEW);
  });
});

describe("playwright config", () => {
  const list = (project: string, origin: string | undefined) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.APP_ORIGIN;
    delete env.TEST_WORKER_INDEX;
    if (origin !== undefined) env.APP_ORIGIN = origin;
    const run = spawnSync(process.execPath, [PLAYWRIGHT, "test", `--project=${project}`, "--list"], {
      cwd: E2E,
      env,
      encoding: "utf8",
    });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  };

  for (const project of ["smoke", "preview-m1"]) {
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
  it("the demo project still loads with its own origin", () => {
    assert.equal(list("desktop", LIVE).status, 0);
  });
});
