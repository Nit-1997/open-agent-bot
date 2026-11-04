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
    for (const name of ["core", "cloud", "cloud-supabase", "local-stack"])
      assert.equal(String(jobs[name].env.ELECTRON_SKIP_BINARY_DOWNLOAD), "1", name);
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
    assert.equal(changes.outputs.desktop, `\${{ steps.filter.outputs.desktop }}`);
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

describe("ci.yml standalone job (M6 D13)", () => {
  const wf = doc("ci.yml");
  const job = wf.jobs.standalone;
  const runs = () => job.steps.map((s) => s.run ?? "").join("\n");
  const usesStep = (prefix) => job.steps.find((s) => String(s.uses ?? "").startsWith(prefix));

  it("runs on pull requests and main: no if, Ubuntu 24.04, 45 minutes, contents: read, no environment, no secrets", () => {
    assert.ok(job);
    assert.equal(job.if, undefined);
    assert.equal(job["runs-on"], "ubuntu-24.04");
    assert.equal(Number(job["timeout-minutes"]), 45);
    assert.deepEqual(job.permissions, { contents: "read" });
    assert.equal(job.environment, undefined);
    assert.equal(JSON.stringify(job).includes("secrets."), false);
  });

  it("checks out full history without persisted credentials and sets up Node from .nvmrc with the npm cache", () => {
    const checkout = usesStep("actions/checkout@");
    assert.equal(Number(checkout.with["fetch-depth"]), 0);
    assert.equal(checkout.with["persist-credentials"], false);
    const node = usesStep("actions/setup-node@");
    assert.equal(node.with["node-version-file"], ".nvmrc");
    assert.equal(node.with.cache, "npm");
  });

  it("uses a private 0700 TMPDIR and the oab-ci-oss project, port, volumes, images and APP_ORIGIN", () => {
    assert.deepEqual(job.env, {
      TMPDIR: "/home/runner/oab-tmp",
      OAB_STANDALONE_ALLOW_DELETE: "1",
      OAB_STANDALONE_PROJECT: "oab-ci-oss",
      OPEN_AGENT_PORT: "18331",
      APP_ORIGIN: "http://127.0.0.1:18331",
      OPEN_AGENT_DATA_VOLUME: "oab-ci-oss-data",
      OPEN_AGENT_KEYS_VOLUME: "oab-ci-oss-keys",
      OPEN_AGENT_IMAGE: "oab-ci-oss-agent:dev",
      OPEN_AGENT_SEARCH_IMAGE: "oab-ci-oss-search:dev",
    });
    assert.match(runs(), /^mkdir -m 700 "\$TMPDIR"$/m);
  });

  it("leaves npm ci and the Playwright install to the script (lockfile-pinned browser) and runs it with --docker --hosted-free (6.4)", () => {
    const text = runs();
    assert.doesNotMatch(text, /npm ci|playwright install|npm install|npm prune/);
    assert.equal(job.steps.at(-1).run.trim(), "bash scripts/ci/standalone.sh --docker --hosted-free");
  });
});

describe("ci.yml cloud job (M6 D14)", () => {
  const job = doc("ci.yml").jobs.cloud;
  const runs = () => job.steps.map((s) => s.run ?? "").filter(Boolean);

  it("runs on pull requests and main with contents: read, no environment and no secrets", () => {
    assert.ok(job);
    assert.equal(job.if, undefined);
    assert.deepEqual(job.permissions, { contents: "read" });
    assert.equal(job.environment, undefined);
    assert.equal(JSON.stringify(job).includes("secrets."), false);
    const checkout = job.steps.find((s) => String(s.uses ?? "").startsWith("actions/checkout@"));
    assert.equal(checkout.with["persist-credentials"], false);
  });

  it("lints, format-checks, type-checks, unit-tests and builds the cloud workspaces only", () => {
    assert.deepEqual(runs(), [
      "npm ci",
      "npm run lint -w @oab/cloud-agent -w @oab/cloud-web -w @oab/cloud-e2e -w @oab/cloud-deploy",
      "npm run lint:boundary && npm run lint:scripts && npm run format:check:scripts",
      "npm run format:check -w @oab/cloud-agent -w @oab/cloud-web -w @oab/cloud-e2e -w @oab/cloud-deploy",
      "npm run typecheck -w @oab/cloud-agent -w @oab/cloud-web -w @oab/cloud-e2e",
      "npm test -w @oab/cloud-agent -w @oab/cloud-web -w @oab/cloud-e2e -w @oab/cloud-deploy",
      "npm run build -w @oab/cloud-agent -w @oab/cloud-web",
    ]);
    assert.doesNotMatch(runs().join("\n"), /test:supabase|playwright|smoke/);
    assert.equal(runs().join("\n").replaceAll("@oab/cloud-e2e", "").includes("e2e"), false);
  });

  it("checks out full history for the hosted compose baseline and the migrations pin (6.6)", () => {
    const checkout = job.steps.find((s) => String(s.uses ?? "").startsWith("actions/checkout@"));
    assert.equal(checkout.with["fetch-depth"], 0);
  });

  it("replaces the web job (6.5)", () => {
    assert.equal(doc("ci.yml").jobs.web, undefined);
    assert.match(JSON.stringify(job.steps.at(-1)), /COPILOTKIT_TELEMETRY_DISABLED/);
  });
});

describe("ci.yml cloud-supabase job (M7 D19)", () => {
  const job = doc("ci.yml").jobs["cloud-supabase"];
  const runs = () => job.steps.map((s) => s.run ?? "").filter(Boolean);

  it("runs on Ubuntu 24.04 for at most 30 minutes with contents: read, no environment and no secrets", () => {
    assert.ok(job);
    assert.equal(job.if, undefined);
    assert.equal(job["runs-on"], "ubuntu-24.04");
    assert.equal(Number(job["timeout-minutes"]), 30);
    assert.deepEqual(job.permissions, { contents: "read" });
    assert.equal(job.environment, undefined);
    assert.equal(JSON.stringify(job).includes("secrets."), false);
  });

  it("installs Supabase CLI 2.111.0 through supabase/setup-cli pinned by commit", () => {
    const cli = job.steps.find((s) => String(s.uses ?? "").startsWith("supabase/setup-cli@"));
    assert.match(cli.uses, /^supabase\/setup-cli@[0-9a-f]{40}$/);
    assert.equal(String(cli.with.version), "2.111.0");
  });

  it("starts oab-m7-ci on 18740, runs test:local with the stack env, and stops the stack in always()", () => {
    assert.ok(runs().includes("node cloud/supabase/scripts/local-stack.mjs start --name oab-m7-ci --ports 18740"));
    const tests = runs().find((r) => r.includes("test:local"));
    assert.match(tests, /stack_env=\$\(node cloud\/supabase\/scripts\/local-stack\.mjs env --name oab-m7-ci\)/);
    assert.match(tests, /OAB_SB_API_URL:\?/);
    assert.match(tests, /npm run test:local -w @oab\/cloud-agent/);
    const teardown = job.steps.at(-1);
    assert.equal(teardown.if, "always()");
    assert.equal(teardown.run, "node cloud/supabase/scripts/local-stack.mjs stop --name oab-m7-ci --ports 18740");
    assert.doesNotMatch(JSON.stringify(job), /--linked|supabase link|config push|supabase\.co|SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF/);
  });
});

describe("ci.yml checkouts", () => {
  it("every checkout in ci.yml leaves no credentials behind", () => {
    for (const [name, job] of Object.entries(doc("ci.yml").jobs)) {
      const checkout = (job.steps ?? []).find((s) => String(s.uses ?? "").startsWith("actions/checkout@"));
      if (checkout) assert.equal(checkout.with?.["persist-credentials"], false, name);
    }
  });
});

describe("ci.yml compose job (M6 D14)", () => {
  const job = doc("ci.yml").jobs.compose;
  const runs = () => job.steps.map((s) => s.run ?? "").filter(Boolean);

  it("runs the local compose tests and the hosted deploy tests from full history (6.6)", () => {
    const checkout = job.steps.find((s) => String(s.uses ?? "").startsWith("actions/checkout@"));
    assert.equal(checkout.with["fetch-depth"], 0);
    assert.ok(runs().includes("node --test scripts/test/composeLayout.test.mjs scripts/test/preflight.test.mjs"));
    assert.ok(runs().includes("npm test -w @oab/cloud-deploy"));
    assert.equal(JSON.stringify(job).includes("secrets."), false);
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
