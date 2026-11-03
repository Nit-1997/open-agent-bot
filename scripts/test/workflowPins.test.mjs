import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, ".github/workflows");
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const read = (file) => readFileSync(join(DIR, file), "utf8");
const doc = (file) => parse(read(file));
const WRITE_SCOPES = ["packages", "id-token", "attestations"];

const usesOf = (text) => [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)].map((m) => ({ ref: m[1], comment: m[2].trim() }));
const triggers = (wf) => (typeof wf.on === "string" ? [wf.on] : Array.isArray(wf.on) ? wf.on : Object.keys(wf.on ?? {}));
const writes = (perms) => (perms && typeof perms === "object" ? WRITE_SCOPES.filter((s) => perms[s] === "write") : []);
const stepsText = (job) => JSON.stringify(job.steps ?? []);

describe("workflow action pins", () => {
  it("finds the workflows", () => {
    for (const f of ["ci.yml", "images.yml", "evals-local.yml"]) assert.ok(FILES.includes(f), f);
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
    it(`${file}: packages/id-token/attestations write only on images.yml push and merge jobs`, () => {
      const wf = doc(file);
      assert.deepEqual(writes(wf.permissions), []);
      for (const [name, job] of Object.entries(wf.jobs ?? {})) {
        const granted = writes(job.permissions);
        if (file === "images.yml" && (name === "push" || name === "merge")) continue;
        assert.deepEqual(granted, [], `${file} job ${name}`);
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
    for (const piece of ["build", "--wait-timeout 300", "npm run local -w e2e", "local-probes.mts", "npm run local:after-restart -w e2e", "down -v"]) {
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
  });
});

describe("images.yml", () => {
  const text = read("images.yml");
  const wf = doc("images.yml");

  it("runs on v* tags and dispatch only", () => {
    assert.deepEqual(Object.keys(wf.on).sort(), ["push", "workflow_dispatch"]);
    assert.deepEqual(wf.on.push, { tags: ["v*"] });
  });

  it("builds natively on amd64 and arm64 runners", () => {
    const include = wf.jobs.build.strategy.matrix.include;
    const legs = include.map((l) => `${l.platform} ${l.runner}`).sort();
    assert.ok(legs.includes("linux/amd64 ubuntu-24.04"));
    assert.ok(legs.includes("linux/arm64 ubuntu-24.04-arm"));
  });

  it("gates the push and merge jobs on a v* tag and grants them the write scopes", () => {
    for (const name of ["push", "merge"]) {
      const job = wf.jobs[name];
      assert.match(job.if, /startsWith\(github\.ref, 'refs\/tags\/v'\)/, name);
      assert.deepEqual(writes(job.permissions).sort(), [...WRITE_SCOPES].sort(), name);
    }
  });

  it("sets provenance mode=max, an SBOM and attests each pushed digest", () => {
    assert.match(text, /provenance: mode=max/);
    assert.match(text, /sbom: true/);
    assert.match(text, /actions\/attest-build-provenance@[0-9a-f]{40}/);
    assert.match(text, /push-to-registry: true/);
  });

  it("passes only the version and revision as build args, never secrets", () => {
    const builds = Object.values(wf.jobs).flatMap((job) => job.steps.filter((s) => String(s.uses ?? "").startsWith("docker/build-push-action@")));
    assert.equal(builds.length, 3);
    for (const step of builds) {
      const args = String(step.with["build-args"]).trim().split("\n");
      assert.deepEqual(args.map((a) => a.split("=")[0]), ["OPEN_AGENT_VERSION", "OPEN_AGENT_REVISION"]);
      assert.equal(JSON.stringify(step.with).includes("secrets."), false);
      assert.equal(step.with.secrets, undefined);
    }
  });

  it("checks the image content (/app for the agent) in the build job and before the push", () => {
    const agentDirs = (job) => job.strategy.matrix.include.filter((l) => l.image === "open-agent").map((l) => l.content);
    for (const name of ["build", "push"]) {
      const job = wf.jobs[name];
      assert.deepEqual([...new Set(agentDirs(job))], ["/app"], name);
      const steps = job.steps.map((s) => s.run ?? "").join("\n");
      assert.match(steps, /find '\$CONTENT_DIR' \\\( -name '\.env\*' -o -name '\*\.pem' -o -name \.factory \\\) -print/, name);
      assert.match(steps, /test -z "\$found"/, name);
    }
    const push = wf.jobs.push.steps;
    const check = push.findIndex((s) => (s.run ?? "").includes("find '$CONTENT_DIR'"));
    const pushed = push.findIndex((s) => String(s.with?.outputs ?? "").includes("push=true"));
    assert.ok(check >= 0 && pushed > check);
  });

  it("never pushes from the build job", () => {
    for (const step of wf.jobs.build.steps) {
      if (!String(step.uses ?? "").startsWith("docker/build-push-action@")) continue;
      assert.equal(step.with.push, false);
      assert.equal(String(step.with.outputs ?? "").includes("push=true"), false);
    }
  });

  it("builds both images", () => {
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
