import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { detachLeftovers, GITHUB_BASH, loadWorkflow, planJob, resolveExpr, runPlanned } from "../release/workflowJobs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TEXT = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
const WF = parse(TEXT);
const V = "0.0.0-dryrun.1";
const runOf = (job) => WF.jobs[job].steps.find((s) => typeof s.run === "string");
const work = mkdtempSync(join(tmpdir(), "oab-m5-wfjobs-"));
after(() => {
  detachLeftovers(work);
  rmSync(work, { recursive: true, force: true });
});
const ctxFor = (name, skip) => ({
  temp: join(work, name),
  version: V,
  artifacts: { "release-lock": join(work, "lock"), "release-dmgs": join(work, `dmgs-${name}`) },
  skip,
});
const ATTEST_SKIP = ["actions/attest-build-provenance@", "actions/upload-artifact@"];

describe("the dry run plans release.yml's own verify-dmgs and attest steps", () => {
  it("verify-dmgs: the run text is release.yml's, byte for byte, with its env resolved and its two downloads", () => {
    const ctx = ctxFor("plan");
    const plan = planJob(loadWorkflow(), "verify-dmgs", ctx);
    assert.equal(plan.run.run, runOf("verify-dmgs").run);
    assert.deepEqual(plan.run.env, {
      VERSION: V,
      LOCK: join(ctx.temp, "release-lock/services.lock.json"),
      DMGS: join(ctx.temp, "release-dmgs"),
    });
    assert.equal(plan.run.cwd, join(ctx.temp, "workspace"));
    assert.deepEqual(
      plan.downloads.map((d) => [d.name, d.from, d.to]),
      [
        ["release-lock", ctx.artifacts["release-lock"], join(ctx.temp, "release-lock")],
        ["release-dmgs", ctx.artifacts["release-dmgs"], join(ctx.temp, "release-dmgs")],
      ],
    );
  });

  it("attest: the SHA256SUMS line is release.yml's, run in its working-directory; OIDC and upload steps are named as skipped", () => {
    const ctx = ctxFor("plan", ATTEST_SKIP);
    const plan = planJob(loadWorkflow(), "attest", ctx);
    assert.equal(plan.run.run, runOf("attest").run);
    assert.match(plan.run.run, /sha256sum .* > SHA256SUMS/);
    assert.equal(plan.run.cwd, join(ctx.temp, "assets"));
    assert.deepEqual(plan.run.env, { VERSION: V });
    assert.deepEqual(plan.skipped, ["actions/attest-build-provenance", "actions/upload-artifact"]);
  });

  it("refuses drift it can't map: a second run step, an unknown expression, an unknown action, an artifact it doesn't make", () => {
    const edit = (f) => {
      const wf = structuredClone(WF);
      f(wf);
      return wf;
    };
    assert.throws(
      () =>
        planJob(
          edit((w) => w.jobs["verify-dmgs"].steps.push({ run: "echo hi" })),
          "verify-dmgs",
          ctxFor("x"),
        ),
      /exactly one run step/,
    );
    assert.throws(
      () =>
        planJob(
          edit((w) => {
            w.jobs["verify-dmgs"].steps.find((s) => s.run).env.EXTRA = `\${{ secrets.X }}`;
          }),
          "verify-dmgs",
          ctxFor("x"),
        ),
      /secrets\.X/,
    );
    assert.throws(
      () =>
        planJob(
          edit((w) => w.jobs["verify-dmgs"].steps.unshift({ uses: "actions/checkout@abc" })),
          "verify-dmgs",
          ctxFor("x"),
        ),
      /no dry-run equivalent/,
    );
    assert.throws(() => planJob(WF, "attest", ctxFor("x")), /no dry-run equivalent/);
    assert.throws(
      () => planJob(WF, "verify-dmgs", { ...ctxFor("x"), artifacts: { "release-lock": "/x" } }),
      /downloads release-dmgs, which the dry run does not produce/,
    );
    assert.throws(
      () =>
        planJob(
          edit((w) => delete w.defaults),
          "verify-dmgs",
          ctxFor("x"),
        ),
      /shell: bash/,
    );
    assert.throws(() => resolveExpr(`\${{ github.token }}`, { temp: "/t", version: V }), /github\.token/);
  });

  it("refuses step and job keys it does not execute, and expressions inside the run text", () => {
    const edit = (f) => {
      const wf = structuredClone(WF);
      f(wf);
      return wf;
    };
    const runStep = (w, job) => w.jobs[job].steps.find((s) => s.run);
    for (const key of ["if", "continue-on-error", "timeout-minutes", "shell", "uses"])
      for (const job of ["verify-dmgs", "attest"])
        assert.throws(
          () =>
            planJob(
              edit((w) => {
                runStep(w, job)[key] = key === "uses" ? "actions/x@1" : "true";
              }),
              job,
              ctxFor("x", ATTEST_SKIP),
            ),
          new RegExp(`${job} .*${key}`),
        );
    for (const key of ["if", "continue-on-error", "timeout-minutes"])
      assert.throws(
        () =>
          planJob(
            edit((w) => {
              w.jobs.attest.steps[0][key] = "true";
            }),
            "attest",
            ctxFor("x", ATTEST_SKIP),
          ),
        new RegExp(`attest .*${key}`),
      );
    assert.throws(
      () =>
        planJob(
          edit((w) => {
            w.jobs.attest.steps[0].with.pattern = "release-*";
          }),
          "attest",
          ctxFor("x", ATTEST_SKIP),
        ),
      /attest .*pattern/,
    );
    for (const key of ["env", "defaults", "if", "container", "strategy", "continue-on-error"])
      assert.throws(
        () =>
          planJob(
            edit((w) => {
              w.jobs["verify-dmgs"][key] = key === "env" ? { X: "1" } : "true";
            }),
            "verify-dmgs",
            ctxFor("x"),
          ),
        new RegExp(`verify-dmgs .*job-level ${key}`),
      );
    assert.throws(
      () =>
        planJob(
          edit((w) => {
            runStep(w, "verify-dmgs").run += `echo "\${{ github.ref }}"\n`;
          }),
          "verify-dmgs",
          ctxFor("x"),
        ),
      /verify-dmgs .*\$\{\{ in its run text/,
    );
  });

  it("release.yml's verify-dmgs and attest use only keys the dry run executes", () => {
    for (const job of ["verify-dmgs", "attest"]) {
      assert.deepEqual(
        Object.keys(WF.jobs[job]).filter(
          (k) => !["needs", "runs-on", "timeout-minutes", "permissions", "environment", "steps"].includes(k),
        ),
        [],
      );
      assert.equal(runOf(job).run.includes("${{"), false);
    }
  });

  it("runs the block the way GitHub's shell: bash does", () => {
    assert.deepEqual(GITHUB_BASH, ["--noprofile", "--norc", "-eo", "pipefail", "-c"]);
    const calls = [];
    const plan = planJob(WF, "attest", ctxFor("fake", ATTEST_SKIP));
    mkdirSync(plan.downloads[0].from, { recursive: true });
    mkdirSync(plan.downloads[1].from, { recursive: true });
    runPlanned(plan, { temp: join(work, "fake") }, (label, cmd, args, o) => calls.push({ label, cmd, args, o }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, "bash");
    assert.deepEqual(calls[0].args, [...GITHUB_BASH, runOf("attest").run]);
    assert.equal(calls[0].o.cwd, join(work, "fake", "assets"));
    assert.equal(calls[0].o.env.RUNNER_TEMP, join(work, "fake"));
    assert.equal(calls[0].o.env.VERSION, V);
  });

  it("dry-run.mjs has no DMG or SHA256SUMS checks of its own; it plans both jobs from release.yml", () => {
    const src = readFileSync(join(ROOT, "scripts/release/dry-run.mjs"), "utf8");
    for (const banned of ["hdiutil", "plutil", "sha256sum", "sums.mjs", "version.mjs", "checkMountedApp", "CFBundleShortVersionString"])
      assert.equal(src.includes(banned), false, banned);
    assert.match(src, /workflowJob\("verify-dmgs"\)/);
    assert.match(src, /workflowJob\("attest", \["actions\/attest-build-provenance@", "actions\/upload-artifact@"\]\)/);
    assert.match(src, /planJob\(wf, job, ctx\)/);
    assert.match(src, /const wf = loadWorkflow\(\);/);
  });
});

const plist = (version) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`;
const LOCK_TEXT = `${JSON.stringify({ schema: 1, kind: "release", version: V }, null, 2)}\n`;

function dmg(out, o = {}) {
  const src = mkdtempSync(join(work, "src-"));
  const app = join(src, o.appName ?? "Open Agent.app");
  mkdirSync(join(app, "Contents/Resources/stack"), { recursive: true });
  writeFileSync(join(app, "Contents/Info.plist"), plist(o.version ?? V));
  const lock = join(app, "Contents/Resources/stack/services.lock.json");
  if (o.symlink) {
    writeFileSync(join(app, "Contents/Resources/real.json"), LOCK_TEXT);
    symlinkSync("../real.json", lock);
  } else writeFileSync(lock, o.lock ?? LOCK_TEXT);
  if (o.second) mkdirSync(join(src, "Other.app/Contents"), { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync("hdiutil", ["makehybrid", "-quiet", "-hfs", "-o", out, src], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

describe("release.yml's verify-dmgs block against real DMGs", { skip: process.platform !== "darwin" && "hdiutil is macOS only" }, () => {
  mkdirSync(join(work, "lock"), { recursive: true });
  writeFileSync(join(work, "lock/services.lock.json"), LOCK_TEXT);
  const run = (name, arm64) => {
    const ctx = ctxFor(name);
    mkdirSync(ctx.artifacts["release-dmgs"], { recursive: true });
    const plan = planJob(WF, "verify-dmgs", ctx);
    const exec = (_label, cmd, args, o) => spawnSync(cmd, args, { cwd: o.cwd, env: o.env, encoding: "utf8" });
    writeFileSync(join(ctx.artifacts["release-dmgs"], `Open-Agent-${V}-arm64.dmg`), readFileSync(arm64));
    let r;
    try {
      r = runPlanned(plan, ctx, exec);
    } finally {
      detachLeftovers(ctx.temp);
    }
    assert.deepEqual(
      readdirSync(ctx.temp).filter((n) => n.startsWith("m-") && readdirSync(join(ctx.temp, n)).length),
      [],
      "no DMG stays mounted",
    );
    return r;
  };
  const variant = (name, o) => {
    const f = join(work, `${name}-arm64.dmg`);
    dmg(f, o);
    return f;
  };

  it("passes when the DMG bundles the lock job's lock at the version", () => {
    const r = run("ok", variant("good", {}));
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const want = createHash("sha256").update(LOCK_TEXT).digest("hex");
    assert.match(r.stdout, new RegExp(`arm64: bundled services.lock.json sha256 ${want}`));
    assert.match(r.stdout, new RegExp(`arm64: CFBundleShortVersionString ${V.replace(/\./g, "\\.")}`));
  });

  for (const [name, o] of [
    ["other-lock", { lock: LOCK_TEXT.replace("dryrun.1", "dryrun.9") }],
    ["wrong-version", { version: "0.0.0-dev" }],
    ["symlinked-lock", { symlink: true }],
    ["second-app", { second: true }],
    ["renamed-app", { appName: "Evil.app" }],
  ])
    it(`fails the job on a DMG with ${name}`, () => {
      const r = run(name, variant(name, o));
      assert.notEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.doesNotMatch(r.stdout, new RegExp(`arm64: CFBundleShortVersionString ${V.replace(/\./g, "\\.")}`));
    });
});
