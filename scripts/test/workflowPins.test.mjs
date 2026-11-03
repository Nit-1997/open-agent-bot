import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, ".github/workflows");
const FILES = readdirSync(DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const read = (file) => readFileSync(join(DIR, file), "utf8");
const doc = (file) => parse(read(file));
const WRITE_SCOPES = ["contents", "packages", "id-token", "attestations"];
const RELEASE_WRITES = {
  push: ["packages", "id-token", "attestations"],
  merge: ["packages", "id-token", "attestations"],
  attest: ["id-token", "attestations"],
  release: ["contents"],
};

const usesOf = (text) => [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)].map((m) => ({ ref: m[1], comment: m[2].trim() }));
const triggers = (wf) => (typeof wf.on === "string" ? [wf.on] : Array.isArray(wf.on) ? wf.on : Object.keys(wf.on ?? {}));
const writes = (perms) => (perms && typeof perms === "object" ? WRITE_SCOPES.filter((s) => perms[s] === "write") : []);
const stepsText = (job) => JSON.stringify(job.steps ?? []);

describe("workflow action pins", () => {
  it("finds the workflows", () => {
    for (const f of ["ci.yml", "release.yml", "evals-local.yml"]) assert.ok(FILES.includes(f), f);
  });

  for (const file of FILES) {
    it(`${file}: every uses: is owner/repo@<40-hex> with a version comment`, () => {
      const uses = usesOf(read(file));
      assert.ok(uses.length > 0);
      for (const { ref, comment } of uses) {
        if (ref.startsWith("./")) continue;
        assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: ${ref}`);
        assert.match(comment, /^#\s*v\d/, `${file}: ${ref} needs a # vN comment`);
      }
    });

    it(`${file}: never uses pull_request_target`, () => {
      assert.equal(read(file).includes("pull_request_target"), false);
      assert.equal(triggers(doc(file)).includes("pull_request_target"), false);
    });

    it(`${file}: defaults to contents: read`, () => assert.deepEqual(doc(file).permissions, { contents: "read" }));
  }
});

describe("write scopes", () => {
  for (const file of FILES) {
    it(`${file}: contents/packages/id-token/attestations write only on the release.yml write jobs`, () => {
      const wf = doc(file);
      assert.deepEqual(writes(wf.permissions), []);
      for (const [name, job] of Object.entries(wf.jobs ?? {})) {
        const want = file === "release.yml" ? (RELEASE_WRITES[name] ?? []) : [];
        assert.deepEqual(writes(job.permissions), want, `${file} job ${name}`);
      }
    });
  }
});

describe("ci.yml local-stack job", () => {
  const wf = doc("ci.yml");
  const job = wf.jobs["local-stack"];

  it("runs only on pull requests, with contents: read and no secrets", () => {
    assert.ok(job);
    assert.equal(job.if, "github.event_name == 'pull_request'");
    assert.deepEqual(job.permissions, { contents: "read" });
    assert.equal(JSON.stringify(job).includes("secrets."), false);
  });

  it("pins the stub port to 18341 and reaches it through host.docker.internal", () => {
    assert.equal(String(job.env.STUB_PORT), "18341");
    assert.equal(job.env.STUB_HOST, "host.docker.internal");
    assert.equal(job.env.STUB_BIND, "0.0.0.0");
  });

  it("builds, waits up to 300 s, runs the subset, probes, restarts, re-checks and tears down with -v in always()", () => {
    const text = stepsText(job);
    for (const piece of [
      "build",
      "--wait-timeout 300",
      "npm run local -w e2e",
      "local-probes.mts",
      "npm run local:after-restart -w e2e",
      "down -v",
    ]) {
      assert.ok(text.includes(piece), piece);
    }
    const teardown = job.steps.at(-1);
    assert.equal(teardown.if, "always()");
    assert.match(teardown.run, /down -v/);
  });

  it("has a Node 24 SQLite job", () => {
    const node24 = wf.jobs["sqlite-node24"];
    assert.ok(node24);
    assert.match(stepsText(node24), /test\/local test\/store/);
    assert.match(stepsText(node24), /--user pwuser/);
    assert.match(stepsText(node24), /mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble@sha256:[0-9a-f]{64} /);
    assert.doesNotMatch(stepsText(node24), /playwright:v[\d.]+-noble(?!@sha256:)/);
    assert.match(
      node24.steps.map((s) => s.run ?? "").join("\n"),
      /case "\$\(node -p process\.versions\.node\)" in 24\.\*\) ;; \*\) echo "[^"]*" >&2; exit 1 ;; esac/,
    );
  });
});

describe("ci.yml desktop jobs", () => {
  const wf = doc("ci.yml");
  const jobs = wf.jobs;
  const DESKTOP_JOBS = ["desktop", "desktop-real", "desktop-package"];
  const runs = (job) => job.steps.map((s) => s.run ?? "").join("\n");
  const usesStep = (job, prefix) => job.steps.find((s) => String(s.uses ?? "").startsWith(prefix));

  it("triggers only on pull_request and push to main", () => {
    assert.deepEqual(Object.keys(wf.on).sort(), ["pull_request", "push"]);
    assert.deepEqual(wf.on.push, { branches: ["main"] });
  });

  for (const name of DESKTOP_JOBS) {
    it(`${name}: contents: read, no secrets, a timeout and a checkout without persisted credentials`, () => {
      const job = jobs[name];
      assert.ok(job, name);
      assert.deepEqual(job.permissions, { contents: "read" });
      assert.equal(JSON.stringify(job).includes("secrets."), false);
      assert.ok(Number(job["timeout-minutes"]) > 0 && Number(job["timeout-minutes"]) <= 60);
      assert.equal(usesStep(job, "actions/checkout@").with["persist-credentials"], false);
      assert.match(runs(job), /npm run electron:install -w @oab\/desktop/);
      assert.equal(JSON.stringify(job.env ?? {}).includes("ELECTRON_SKIP_BINARY_DOWNLOAD"), false);
    });
  }

  it("the jobs that never run Electron skip its binary download", () => {
    for (const name of ["core", "web", "local-stack"]) assert.equal(String(jobs[name].env.ELECTRON_SKIP_BINARY_DOWNLOAD), "1", name);
  });

  it("desktop: Ubuntu, checks and unit tests for @oab/desktop, then the fake-docker e2e under xvfb", () => {
    const job = jobs.desktop;
    assert.equal(job["runs-on"], "ubuntu-24.04");
    const text = runs(job);
    for (const piece of [
      "npm ci",
      "npm run lint -w @oab/desktop",
      "npm run format:check -w @oab/desktop",
      "npm run typecheck -w @oab/desktop",
      "npm test -w @oab/desktop",
      "npm run build -w @oab/desktop",
      "npm run stage -w @oab/desktop",
      "xvfb-run -a npx playwright test -c playwright.desktop.config.ts --project desktop-fake",
    ])
      assert.ok(text.includes(piece), piece);
    assert.doesNotMatch(text, /DESKTOP_REAL_DOCKER/);
  });

  it("desktop-real: Ubuntu with real Docker, local images, the stub on 18341, oab-ci-desktop on 18350-18359, torn down in always()", () => {
    const job = jobs["desktop-real"];
    assert.equal(job["runs-on"], "ubuntu-24.04");
    assert.equal(String(job.env.DESKTOP_REAL_DOCKER), "1");
    assert.equal(String(job.env.OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET), "1");
    assert.equal(job.env.DESKTOP_REAL_PROJECT, "oab-ci-desktop");
    assert.equal(job.env.DESKTOP_REAL_RANGE, "18350-18359");
    assert.equal(String(job.env.STUB_PORT), "18341");
    assert.equal(job.env.STUB_BIND, "0.0.0.0");
    assert.equal(job.env.STUB_HOST, "host.docker.internal");
    const text = runs(job);
    for (const piece of [
      "docker build -f packages/core/Dockerfile",
      "-t oab-ci-agent:dev",
      "-t oab-ci-search:dev local/searxng",
      "DESKTOP_REAL_SERVICES=",
      "e2e/support/stubModel.ts",
      "xvfb-run -a npx playwright test -c playwright.desktop.config.ts --project desktop-real",
    ])
      assert.ok(text.includes(piece), piece);
    const teardown = job.steps.at(-1);
    assert.equal(teardown.if, "always()");
    assert.match(teardown.run, /down -v/);
    assert.match(teardown.run, /oab-ci-desktop/);
  });

  it("desktop-package: macOS 15, only when the shell, the stack files or the workflow change (or on main), both DMGs and the packaged smoke", () => {
    const job = jobs["desktop-package"];
    assert.equal(job["runs-on"], "macos-15");
    assert.deepEqual([job.needs].flat(), ["desktop-changes"]);
    assert.equal(job.if, "needs.desktop-changes.outputs.desktop == 'true'");
    const changes = jobs["desktop-changes"];
    assert.equal(changes["runs-on"], "ubuntu-24.04");
    assert.deepEqual(changes.permissions, { contents: "read" });
    assert.equal(changes.outputs.desktop, "${{ steps.filter.outputs.desktop }}");
    const filter = changes.steps.find((s) => s.id === "filter");
    for (const path of ["apps/desktop/", "docker-compose\\.yml", "local/renderer/seccomp\\.json", "\\.github/workflows/ci\\.yml"])
      assert.ok(filter.run.includes(path), path);
    assert.match(filter.run, /git diff --name-only "\$BASE_SHA" "\$HEAD_SHA"/);
    assert.equal(JSON.stringify(filter).includes("${{ github.event.pull_request"), true);
    assert.equal(filter.run.includes("${{"), false);
    const text = runs(job);
    assert.match(text, /npm run dist -w @oab\/desktop -- --arm64 --x64/);
    assert.match(
      text,
      /packagedSmoke\.mjs .*--app "apps\/desktop\/release\/mac-arm64\/Open Agent\.app" --app "apps\/desktop\/release\/mac\/Open Agent\.app"/,
    );
    assert.match(text, /--dmg/);
    const dist = job.steps.find((s) => (s.run ?? "").includes("npm run dist"));
    assert.equal(String(dist.env.CSC_IDENTITY_AUTO_DISCOVERY), "false");
    const upload = usesStep(job, "actions/upload-artifact@");
    assert.equal(Number(upload.with["retention-days"]), 7);
    assert.match(upload.with.path, /\.dmg/);
  });
});

describe("release.yml", () => {
  const text = read("release.yml");
  const wf = doc("release.yml");

  it("runs on v* tags only", () => assert.deepEqual(wf.on, { push: { tags: ["v*"] } }));

  it("sets provenance mode=max, an SBOM and attests what it pushes", () => {
    assert.match(text, /provenance: mode=max/);
    assert.match(text, /sbom: true/);
    assert.match(text, /actions\/attest-build-provenance@[0-9a-f]{40}/);
    assert.match(text, /push-to-registry: true/);
  });

  it("builds both images, the agent content check on /app", () => {
    const include = wf.jobs.push.strategy.matrix.include;
    assert.deepEqual([...new Set(include.filter((l) => l.image === "open-agent").map((l) => l.content))], ["/app"]);
    assert.deepEqual([...new Set(include.filter((l) => l.image === "open-agent-search").map((l) => l.content))], ["/opt/open-agent"]);
    assert.match(text, /packages\/core\/Dockerfile/);
    assert.match(text, /local\/searxng/);
  });
});

describe("evals-local.yml", () => {
  const wf = doc("evals-local.yml");

  it("runs in the evals environment with contents: read", () => {
    const jobs = Object.values(wf.jobs);
    assert.ok(jobs.length > 0);
    for (const job of jobs) assert.equal(job.environment, "evals");
  });

  it("skips with a notice when OPENROUTER_API_KEY is absent", () => {
    const text = read("evals-local.yml");
    assert.match(text, /::notice::/);
    assert.match(text, /OPENROUTER_API_KEY/);
    assert.match(text, /--target local/);
  });
});

describe("OCI labels", () => {
  for (const file of ["packages/core/Dockerfile", "local/searxng/Dockerfile"]) {
    it(`${file} labels the version and revision from build args`, () => {
      const text = readFileSync(join(ROOT, file), "utf8");
      assert.match(text, /^ARG OPEN_AGENT_VERSION=dev$/m);
      assert.match(text, /^ARG OPEN_AGENT_REVISION=unknown$/m);
      assert.match(text, /org\.opencontainers\.image\.version="\$\{OPEN_AGENT_VERSION\}"/);
      assert.match(text, /org\.opencontainers\.image\.revision="\$\{OPEN_AGENT_REVISION\}"/);
      assert.match(text, /org\.opencontainers\.image\.licenses="MIT"/);
    });
  }
});
