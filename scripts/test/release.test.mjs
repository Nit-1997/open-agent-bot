import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { assertLock } from "../release/assert-lock.mjs";
import { draftRelease, dryRunProblems, IMAGES, mockRelease, parseDryRunArgs } from "../release/dry-run.mjs";
import { gate, releaseState } from "../release/gate.mjs";
import { contentCheck, imageChecks, labelsCheck, mergeDigest, nodeCheck } from "../release/image-checks.mjs";
import { notesCommand } from "../release/notes.mjs";
import {
  assertReleaseLock,
  baseImages,
  checkIndex,
  checkPolicy,
  indexDigest,
  notes,
  parseTag,
  previousFinalTag,
  RELEASE_IMAGES,
  releaseAssets,
  safeChange,
  versionOf,
} from "../release/releaseLib.mjs";
import { verifyIndex } from "../release/verify-index.mjs";
import { writeLock } from "../release/write-lock.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "scripts/test/fixtures/release");
const fixture = (n) => readFileSync(join(FIX, n));
const D = (c) => c.repeat(64);
const COMPOSE = createHash("sha256")
  .update(readFileSync(join(ROOT, "docker-compose.yml")))
  .digest("hex");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const PROD = { agent: `ghcr.io/nit-1997/open-agent@sha256:${D("a")}`, search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}` };
const LOCAL = {
  agent: `127.0.0.1:18501/oab-m5-open-agent@sha256:${D("c")}`,
  search: `127.0.0.1:18501/oab-m5-open-agent-search@sha256:${D("d")}`,
};
const TEST_ENV = { OPEN_AGENT_SHELL_TEST: "1" };
const scratch = () => mkdtempSync(join(tmpdir(), "oab-m5-test-"));
const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const bad = (stderr, status = 1) => ({ status, stdout: "", stderr });

describe("parseTag / versionOf", () => {
  for (const [tag, version, prerelease] of [
    ["v1.0.0", "1.0.0", false],
    ["v1.0.0-rc.1", "1.0.0-rc.1", true],
    ["v10.20.30", "10.20.30", false],
    ["v0.0.0", "0.0.0", false],
  ])
    it(`accepts ${tag}`, () => {
      assert.deepEqual(parseTag(tag), { ok: true, tag, version, prerelease });
      assert.equal(versionOf(tag), version);
      assert.ok(!versionOf(tag).startsWith("v"));
    });
  for (const tag of ["1.0.0", "v1.0", "v01.0.0", "v1.0.0-beta.1", "v1.0.0-rc.01", "v1.0.0+meta", "v1.0.0-rc.1\n", "v1.0.0-rc", ""])
    it(`refuses ${JSON.stringify(tag)}`, () => {
      assert.equal(parseTag(tag).ok, false);
      assert.throws(() => versionOf(tag));
    });
  it("allows v0.0.0-dryrun.N only in a dry run, never as a prerelease", () => {
    assert.equal(parseTag("v0.0.0-dryrun.1").ok, false);
    assert.deepEqual(parseTag("v0.0.0-dryrun.1", { dryRun: true }), {
      ok: true,
      tag: "v0.0.0-dryrun.1",
      version: "0.0.0-dryrun.1",
      prerelease: false,
    });
    assert.equal(parseTag("v1.0.0-dryrun.1", { dryRun: true }).ok, false);
  });
  it("the dry run reads the version from gate --dry-run; version.mjs, sums.mjs and --expect-sha256 are gone", () => {
    for (const f of ["scripts/release/version.mjs", "scripts/release/sums.mjs"]) assert.equal(existsSync(join(ROOT, f)), false, f);
    const src = readFileSync(join(ROOT, "scripts/release/dry-run.mjs"), "utf8");
    assert.match(src, /gate\.mjs"\), \["--tag", tag, "--dry-run"\]/);
    assert.doesNotMatch(readFileSync(join(ROOT, "scripts/release/assert-lock.mjs"), "utf8"), /expect-sha256/);
  });
});

describe("checkPolicy", () => {
  it("passes at or below the version and fails above it", () => {
    assert.deepEqual(checkPolicy({ minShellVersion: "0.0.0" }, "1.0.0"), []);
    assert.deepEqual(checkPolicy({ minShellVersion: "1.0.0" }, "1.0.0"), []);
    assert.deepEqual(checkPolicy({ minShellVersion: "1.0.0" }, "1.0.0-rc.1"), []);
    assert.deepEqual(checkPolicy({ minShellVersion: "0.0.0" }, "0.0.0-dryrun.1"), []);
    assert.match(checkPolicy({ minShellVersion: "1.1.0" }, "1.0.0")[0], /above the release version/);
  });
  for (const p of [
    { minShellVersion: "1.0" },
    { minShellVersion: 1 },
    { minShellVersion: "1.0.0-rc.1" },
    {},
    [],
    null,
    { minShellVersion: "0.0.0", x: 1 },
  ])
    it(`refuses ${JSON.stringify(p)}`, () => assert.equal(checkPolicy(p, "1.0.0").length, 1));
  it("the committed policy is 0.0.0", () => {
    assert.deepEqual(JSON.parse(readFileSync(join(ROOT, "apps/desktop/release-policy.json"), "utf8")), { minShellVersion: "0.0.0" });
  });
});

describe("gate.mjs", () => {
  const read = (p) => (p.endsWith("release-policy.json") ? '{"minShellVersion":"0.0.0"}' : JSON.stringify({ composeSha256: COMPOSE }));
  const gh = JSON.parse(fixture("gh-release-view.json").toString("utf8"));
  const git =
    (o = {}) =>
    (args) => {
      const key = args.join(" ");
      if (key === "cat-file -t refs/tags/v1.0.0") return o.catFile ?? ok("tag\n");
      if (key === "rev-parse refs/tags/v1.0.0^{commit}") return o.revParse ?? ok(`${SHA}\n`);
      if (key === `merge-base --is-ancestor ${SHA} origin/main`) return o.ancestor ?? ok();
      throw new Error(`unexpected git ${key}`);
    };
  const run = (o = {}) =>
    gate({ tag: "v1.0.0", sha: SHA, git: git(o), gh: () => o.gh ?? gh.notFound, read, composeSha: () => o.compose ?? COMPOSE });

  it("passes an annotated tag on main with no release", () => {
    assert.deepEqual(run(), { ok: true, problems: [], version: "1.0.0", prerelease: false, skipped: false });
  });
  it("refuses a lightweight tag", () => assert.match(run({ catFile: ok("commit\n") }).problems.join(), /not an annotated tag/));
  it("refuses a tag whose object was not fetched", () =>
    assert.match(run({ catFile: bad("fatal: Not a valid object name") }).problems.join(), /fetched/));
  it("refuses an annotated tag pointing at another commit", () =>
    assert.match(run({ revParse: ok(`${"f".repeat(40)}\n`) }).problems.join(), /not the workflow commit/));
  it("refuses a commit that is not an ancestor of main", () =>
    assert.match(run({ ancestor: bad("", 1) }).problems.join(), /not an ancestor/));
  it("treats only 'release not found' as absent", () => assert.equal(releaseState(gh.notFound).state, "absent"));
  for (const k of ["auth", "network", "server"])
    it(`fails the gate on a gh ${k} error with its message`, () => {
      const r = run({ gh: gh[k] });
      assert.equal(r.ok, false);
      assert.ok(
        r.problems.some((p) => p.includes(gh[k].stderr.trim().split("\n")[0])),
        r.problems.join(),
      );
    });
  it("fails when a published release exists", () => assert.match(run({ gh: gh.found }).problems.join(), /already exists/));
  it("fails when the compose hash differs from the committed lock", () =>
    assert.match(run({ compose: D("9") }).problems.join(), /compose hash/));
  it("fails on a malformed tag before calling git", () =>
    assert.equal(gate({ tag: "v1.0", sha: SHA, git: () => assert.fail("git"), gh: () => assert.fail("gh"), read }).ok, false));
  it("dry run skips the GitHub-only checks", () => {
    const r = gate({
      tag: "v0.0.0-dryrun.1",
      sha: undefined,
      dryRun: true,
      git: () => assert.fail("git"),
      gh: () => assert.fail("gh"),
      read,
    });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
  });
  it("the real CLI checks the repo policy and compose hash in a dry run", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/release/gate.mjs"), "--tag", "v0.0.0-dryrun.1", "--dry-run"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...TEST_ENV },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /gate: tag=v0.0.0-dryrun.1 version=0.0.0-dryrun.1 prerelease=false/);
    assert.match(r.stdout, /skipped: annotated tag, ancestor of main, release absent \(GitHub only\)/);
  });
});

describe("previousFinalTag", () => {
  const tags = ["v0.9.0", "v1.0.0-rc.1", "v1.0.0", "v1.0.1-rc.1", "v1.0.1", "v1.1.0-rc.1", "v2.0.0"];
  it("picks the highest lower final tag, skipping -rc and the tag itself", () => {
    assert.equal(previousFinalTag(tags, "v1.1.0"), "v1.0.1");
    assert.equal(previousFinalTag(tags, "v1.1.0-rc.1"), "v1.0.1");
    assert.equal(previousFinalTag(tags, "v1.0.1"), "v1.0.0");
    assert.equal(previousFinalTag(tags, "v1.0.0"), "v0.9.0");
  });
  it("returns undefined when there is none", () => {
    assert.equal(previousFinalTag(tags, "v0.9.0"), undefined);
    assert.equal(previousFinalTag([], "v1.0.0"), undefined);
    assert.equal(previousFinalTag(["v1.0.0-rc.1"], "v1.0.0"), undefined);
  });
});

describe("index checks (D5)", () => {
  const good = fixture("index-good.json");
  const ref = (raw) => `127.0.0.1:18501/oab-m5-open-agent@${indexDigest(raw)}`;
  it("the good index passes with two platforms and two attestation manifests", () => {
    const r = checkIndex(good, { digest: indexDigest(good), tagDigest: indexDigest(good) });
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.platforms.map((p) => p.platform).sort(), ["linux/amd64", "linux/arm64"]);
    assert.equal(r.attestations.length, 2);
  });
  it("indexDigest is the sha256 of the raw bytes", () =>
    assert.equal(indexDigest(good), "sha256:e9f3144a07bcd5b417dfcc06deda0947442526406d4dd208ffaa4026ee372143"));
  for (const [file, reason] of [
    ["index-missing-arch.json", /platforms are \[linux\/arm64\]/],
    ["index-extra-platform.json", /platforms are \[linux\/amd64, linux\/arm\/v7, linux\/arm64\]/],
    ["index-unknown-no-annotation.json", /is not an attestation manifest/],
    ["index-attestation-unknown-digest.json", /not a listed platform manifest/],
    ["manifest-single.json", /is not an OCI image index/],
  ])
    it(`${file} fails: ${reason.source}`, () => {
      const raw = fixture(file);
      const r = checkIndex(raw, { digest: indexDigest(raw), tagDigest: indexDigest(raw) });
      assert.equal(r.ok, false);
      assert.match(r.reason, reason);
    });
  it("a Docker manifest list with both platforms passes", () => {
    const raw = fixture("manifest-list-docker.json");
    assert.equal(checkIndex(raw, { digest: indexDigest(raw), tagDigest: indexDigest(raw) }).ok, true);
  });
  it("a tag that moved fails", () => {
    const r = verifyIndex({ ref: ref(good), version: "0.0.0-dryrun.1", raw: good, tagDigest: `sha256:${D("e")}` });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /version tag resolves to/);
  });
  it("raw bytes that don't hash to the ref digest fail", () => {
    const r = verifyIndex({ ref: `x@sha256:${D("e")}`, version: "1.0.0", raw: good, tagDigest: `sha256:${D("e")}` });
    assert.match(r.lines[0], /hashes to/);
  });
  it("verify-index prints the platforms and the dropped attestation manifests", () => {
    const r = verifyIndex({ ref: ref(good), version: "0.0.0-dryrun.1", raw: good, tagDigest: indexDigest(good) });
    assert.equal(r.ok, true);
    assert.equal(r.lines.filter((l) => l.includes("platform linux/")).length, 2);
    assert.equal(r.lines.filter((l) => l.includes("dropped unknown/unknown attestation-manifest")).length, 2);
  });
});

describe("image-checks.mjs", () => {
  const recorder = (reply) => {
    const calls = [];
    const docker = (args) => {
      calls.push(args);
      return reply(args);
    };
    return { calls, docker };
  };
  it("content: a hit fails and prints the count", () => {
    const { docker, calls } = recorder(() => ok("/app/.env\n/app/x.pem\n"));
    const r = contentCheck({ docker, image: "img", dir: "/app" });
    assert.equal(r.ok, false);
    assert.equal(r.lines[0], "content: forbidden files in img under /app: 2");
    assert.deepEqual(calls[0].slice(0, 7), ["run", "--rm", "--pull", "never", "--entrypoint", "sh", "img"]);
  });
  it("content: none passes; a docker failure fails", () => {
    assert.equal(contentCheck({ docker: () => ok(""), image: "img", dir: "/app" }).ok, true);
    assert.equal(contentCheck({ docker: () => bad("no such image"), image: "img", dir: "/app" }).ok, false);
  });
  it("labels: a mismatch fails, a match passes", () => {
    const labels = JSON.stringify({ "org.opencontainers.image.version": "1.0.0", "org.opencontainers.image.revision": SHA });
    assert.equal(labelsCheck({ docker: () => ok(labels), image: "i", version: "1.0.0", revision: SHA }).ok, true);
    assert.equal(labelsCheck({ docker: () => ok(labels), image: "i", version: "v1.0.0", revision: SHA }).ok, false);
    assert.equal(labelsCheck({ docker: () => ok(labels), image: "i", version: "1.0.0", revision: "x" }).ok, false);
  });
  it("labels --pull drops the local copy, then pulls the platform", () => {
    const { docker, calls } = recorder((a) => (a[0] === "pull" ? ok() : ok("{}")));
    labelsCheck({ docker, image: "i", version: "1", revision: "r", platform: "linux/arm64", pull: true });
    assert.deepEqual(calls.slice(0, 2), [
      ["image", "rm", "--force", "i"],
      ["pull", "--quiet", "--platform", "linux/arm64", "i"],
    ]);
  });
  it("node, node and labels on one index digest pass on a store that holds one platform per digest", () => {
    const image = `ghcr.io/nit-1997/open-agent@sha256:${"a".repeat(64)}`;
    let held;
    const fetch = (platform) => {
      if (held && held !== platform) return { status: 125, stdout: "", stderr: `docker: cannot overwrite digest ${image.split("@")[1]}` };
      held = platform;
      return null;
    };
    const docker = (a) => {
      if (a[0] === "image" && a[1] === "rm") {
        held = undefined;
        return ok();
      }
      if (a[0] === "pull") return fetch(a[a.indexOf("--platform") + 1]) ?? ok();
      if (a[0] === "run") return fetch(a[a.indexOf("--platform") + 1]) ?? ok("24.22.1\n");
      if (a[0] === "image" && a[1] === "inspect")
        return ok(JSON.stringify({ "org.opencontainers.image.version": "1.0.0", "org.opencontainers.image.revision": SHA }));
      return ok();
    };
    assert.equal(nodeCheck({ docker, image, platform: "linux/amd64" }).ok, true);
    assert.equal(nodeCheck({ docker, image, platform: "linux/arm64" }).ok, true);
    assert.equal(labelsCheck({ docker, image, version: "1.0.0", revision: SHA, platform: "linux/amd64", pull: true }).ok, true);
  });
  it("node: 22 fails, 24.x passes", () => {
    assert.equal(nodeCheck({ docker: () => ok("22.12.0\n"), image: "i", platform: "linux/amd64" }).ok, false);
    assert.equal(nodeCheck({ docker: () => ok("24.22.1\n"), image: "i", platform: "linux/amd64" }).ok, true);
  });
  it("merge-digest reads the --metadata-file fixture and the inspect fallback", () => {
    assert.equal(
      mergeDigest({ metadata: fixture("imagetools-create-metadata.json").toString() }),
      "sha256:329912742a9b65eeb63f23b143a78aa87ea7cdc3fac0fd78526c6e1b8becd0d0",
    );
    assert.equal(
      mergeDigest({ inspectJson: fixture("imagetools-inspect-manifest.json").toString() }),
      "sha256:e9f3144a07bcd5b417dfcc06deda0947442526406d4dd208ffaa4026ee372143",
    );
    assert.throws(() => mergeDigest({ metadata: "{}" }), /no sha256 index digest/);
  });
  it("merge-digest writes name and digest outputs", () => {
    const dir = scratch();
    const out = join(dir, "o");
    const r = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts/release/image-checks.mjs"),
        "merge-digest",
        "--metadata",
        join(FIX, "imagetools-create-metadata.json"),
        "--name",
        "ghcr.io/nit-1997/open-agent",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_OUTPUT: out } },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      readFileSync(out, "utf8"),
      "name=ghcr.io/nit-1997/open-agent\ndigest=sha256:329912742a9b65eeb63f23b143a78aa87ea7cdc3fac0fd78526c6e1b8becd0d0\n",
    );
    rmSync(dir, { recursive: true });
  });
  it("exits 1 on a failed check", () =>
    assert.equal(
      imageChecks(["node", "--image", "i", "--platform", "linux/arm64"], () => ok("22.0.0")),
      1,
    ));
});

describe("write-lock.mjs", () => {
  const dir = scratch();
  const args = (images, extra) => [
    "--version",
    extra.version ?? "1.0.0",
    "--agent",
    images.agent,
    "--search",
    images.search,
    "--out-lock",
    join(dir, "lock.json"),
    "--out-manifest",
    join(dir, "manifest.json"),
    ...(extra.flags ?? []),
  ];
  const attested = (o = {}) => {
    const f = join(dir, `attested-${Math.random()}.json`);
    const entry = (ref) => ({ ref, digest: ref.split("@")[1], verified: true });
    writeFileSync(f, JSON.stringify({ agent: entry(PROD.agent), search: entry(PROD.search), ...o }));
    return f;
  };
  const w = (images, extra = {}) => writeLock(args(images, extra), extra.env ?? {}, { composeSha256: COMPOSE });

  it("production refs without --attested fail", () => assert.throws(() => w(PROD), /--attested/));
  it("--attested missing one digest fails", () =>
    assert.throws(() => w(PROD, { flags: ["--attested", attested({ search: undefined })] }), /no verified search/));
  it("--attested with a different digest fails", () =>
    assert.throws(
      () => w(PROD, { flags: ["--attested", attested({ agent: { ref: PROD.agent, digest: `sha256:${D("f")}`, verified: true } })] }),
      /digest/,
    ));
  it("--dry-run without OPEN_AGENT_SHELL_TEST=1 fails", () =>
    assert.throws(() => w(LOCAL, { version: "0.0.0-dryrun.1", flags: ["--dry-run"] }), /OPEN_AGENT_SHELL_TEST/));
  it("--dry-run with ghcr refs fails", () =>
    assert.throws(() => w(PROD, { version: "0.0.0-dryrun.1", flags: ["--dry-run"], env: TEST_ENV }), /not a local-registry ref/));
  it("local refs without --dry-run fail", () =>
    assert.throws(() => w(LOCAL, { flags: ["--attested", attested()] }), /not a production ref/));
  it("--dry-run requires a 0.0.0-dryrun.N version", () =>
    assert.throws(() => w(LOCAL, { flags: ["--dry-run"], env: TEST_ENV }), /0\.0\.0-dryrun/));
  it("a dry-run version never takes --attested", () =>
    assert.throws(() => w(PROD, { version: "0.0.0-dryrun.1", flags: ["--attested", attested()] }), /dry-run version/));
  it("--dry-run and --attested together fail", () =>
    assert.throws(
      () => w(LOCAL, { version: "0.0.0-dryrun.1", flags: ["--dry-run", "--attested", attested()], env: TEST_ENV }),
      /not both/,
    ));

  it("writes a release lock and manifest that are byte-stable, 0644, manifest = lock + minShellVersion", () => {
    const a = attested();
    const { lock, manifest } = w(PROD, { flags: ["--attested", a] });
    const first = [readFileSync(join(dir, "lock.json")), readFileSync(join(dir, "manifest.json"))];
    w(PROD, { flags: ["--attested", a] });
    assert.deepEqual([readFileSync(join(dir, "lock.json")), readFileSync(join(dir, "manifest.json"))], first);
    assert.equal(first[0].toString(), `${JSON.stringify(lock, null, 2)}\n`);
    assert.deepEqual(Object.keys(lock), ["schema", "kind", "version", "composeSha256", "images", "pull"]);
    assert.deepEqual(manifest, { ...lock, minShellVersion: "0.0.0" });
    assert.equal(statSync(join(dir, "lock.json")).mode & 0o777, 0o644);
  });

  it("both files pass the shell's validatePins with the matching test flag", () => {
    const a = attested();
    w(PROD, { flags: ["--attested", a] });
    const prodFiles = [readFileSync(join(dir, "lock.json"), "utf8"), readFileSync(join(dir, "manifest.json"), "utf8")];
    w(LOCAL, { version: "0.0.0-dryrun.1", flags: ["--dry-run"], env: TEST_ENV });
    const dryFiles = [readFileSync(join(dir, "lock.json"), "utf8"), readFileSync(join(dir, "manifest.json"), "utf8")];
    const probe = `
      const mod = await import(${JSON.stringify(join(ROOT, "apps/desktop/src/main/services.ts"))});
      const { validatePins } = mod.validatePins ? mod : mod.default;
      const [prod, dry, compose] = JSON.parse(process.argv[1]);
      const ctx = (test) => ({ test, composeSha256: compose, shellVersion: "0.0.0-dev" });
      const r = (s, t) => { const v = validatePins(JSON.parse(s), ctx(t)); return v.ok ? "ok" : v.reason; };
      console.log(JSON.stringify([prod.map((s) => r(s, false)), dry.map((s) => r(s, true)), dry.map((s) => r(s, false))]));`;
    const res = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", probe, JSON.stringify([prodFiles, dryFiles, COMPOSE])],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), [
      ["ok", "ok"],
      ["ok", "ok"],
      ["release_refs", "release_refs"],
    ]);
  });
});

describe("assert-lock.mjs", () => {
  const dir = scratch();
  const lock = (o = {}) => ({
    schema: 1,
    kind: "release",
    version: "1.0.0",
    composeSha256: COMPOSE,
    images: { ...PROD },
    pull: true,
    ...o,
  });
  const att = join(dir, "attested.json");
  writeFileSync(
    att,
    JSON.stringify({
      agent: { ref: PROD.agent, digest: `sha256:${D("a")}`, verified: true },
      search: { ref: PROD.search, digest: `sha256:${D("b")}`, verified: true },
    }),
  );
  const check = (value, flags = ["--attested", att], env = {}) => {
    const f = join(dir, `lock-${Math.random()}.json`);
    writeFileSync(f, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
    return assertLock([f, "--version", "1.0.0", ...flags], env, { composeSha256: COMPOSE });
  };
  it("a good lock passes", () => assert.deepEqual(check(lock()), []));
  for (const [name, value, reason] of [
    ["kind local", lock({ kind: "local" }), /kind is "local"/],
    ["kind dev", lock({ kind: "dev" }), /kind is "dev"/],
    ["kind missing", lock({ kind: undefined }), /kind is undefined/],
    ["images null", lock({ images: null }), /images is null/],
    ["imageIds", lock({ imageIds: { agent: `sha256:${D("1")}`, search: `sha256:${D("2")}` } }), /imageIds/],
    ["pull false", lock({ pull: false }), /pull is false/],
    ["pull missing", lock({ pull: undefined }), /pull is undefined/],
    ["wrong version", lock({ version: "1.0.1" }), /version is "1.0.1"/],
    ["compose mismatch", lock({ composeSha256: D("9") }), /composeSha256/],
    ["minShellVersion", lock({ minShellVersion: "0.0.0" }), /minShellVersion is present/],
    ["a tag ref", lock({ images: { agent: "ghcr.io/nit-1997/open-agent:1.0.0", search: PROD.search } }), /not a production ref/],
    ["a local-registry ref on the real path", lock({ images: { agent: LOCAL.agent, search: PROD.search } }), /not a production ref/],
    ["an extra image", lock({ images: { ...PROD, renderer: PROD.agent } }), /exactly agent and search/],
    [
      "a digest that differs from attested.json",
      lock({ images: { agent: `ghcr.io/nit-1997/open-agent@sha256:${D("f")}`, search: PROD.search } }),
      /attested\.json agent/,
    ],
    ["the committed no-pins lock", readFileSync(join(ROOT, "apps/desktop/services.lock.json"), "utf8"), /version is "dev"/],
  ])
    it(`${name} fails`, () => assert.match(check(value).join("\n"), reason));
  it("the dry-run path needs test mode, local refs and a dryrun version", () => {
    const dry = lock({ version: "0.0.0-dryrun.1", images: { ...LOCAL } });
    const f = join(dir, "dry.json");
    writeFileSync(f, JSON.stringify(dry));
    const a = (flags, env) => assertLock([f, "--version", "0.0.0-dryrun.1", ...flags], env, { composeSha256: COMPOSE });
    assert.deepEqual(a(["--dry-run"], TEST_ENV), []);
    assert.match(a(["--dry-run"], {}).join(), /OPEN_AGENT_SHELL_TEST/);
    assert.match(a(["--attested", att], {}).join(), /dry-run version/);
    writeFileSync(f, JSON.stringify({ ...dry, images: PROD }));
    assert.match(a(["--dry-run"], TEST_ENV).join(), /not a local-registry ref/);
  });
  it("the M4 one-liner's rules hold for a dev lock fixture", () => {
    assert.match(
      assertReleaseLock(
        { schema: 1, kind: "dev", version: "1.0.0", composeSha256: COMPOSE, images: LOCAL, pull: true },
        { version: "1.0.0", composeSha256: COMPOSE },
      ).join(),
      /kind/,
    );
  });
});

describe("notes.mjs", () => {
  const bases = baseImages(
    readFileSync(join(ROOT, "packages/core/Dockerfile"), "utf8"),
    readFileSync(join(ROOT, "local/searxng/Dockerfile"), "utf8"),
  );
  const pinned = (subject, v) =>
    `gh attestation verify ${subject} --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref refs/tags/v${v} --deny-self-hosted-runners`;
  it("reads the base refs from the Dockerfiles", () => {
    assert.match(bases.agent, /^mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}$/);
    assert.match(bases.search, /^searxng\/searxng:latest@sha256:[0-9a-f]{64}$/);
  });
  it("holds the digests, bases, changes, the corruption-vs-authenticity wording and pinned verify lines", () => {
    const text = notes({
      version: "1.0.0",
      prerelease: false,
      digests: PROD,
      bases,
      changes: ["abc1234 fix: a thing"],
      previousTag: "v0.9.0",
    });
    for (const s of [
      PROD.agent,
      PROD.search,
      bases.agent,
      bases.search,
      "- abc1234 `fix: a thing`",
      "## Changes since v0.9.0",
      "Open-Agent-1.0.0-arm64.dmg",
      "Open-Agent-1.0.0-x64.dmg",
    ])
      assert.ok(text.includes(s), s);
    assert.ok(text.includes(pinned("Open-Agent-1.0.0-arm64.dmg", "1.0.0")));
    assert.ok(text.includes(pinned(`oci://${PROD.agent}`, "1.0.0")));
    assert.ok(text.includes(pinned(`oci://${PROD.search}`, "1.0.0")));
    assert.ok(text.includes("shasum -a 256 -c SHA256SUMS"));
    assert.match(text, /broken or incomplete download/);
    assert.match(text, /authenticity/);
    assert.ok(text.includes('xattr -dr com.apple.quarantine "/Applications/Open Agent.app"'));
    assert.ok(text.includes("https://github.com/Nit-1997/open-agent-bot/blob/v1.0.0/docs/INSTALL.md"));
    assert.ok(text.includes("git clone --branch v1.0.0 --depth 1 https://github.com/Nit-1997/open-agent-bot"));
    assert.doesNotMatch(text, /open-agent(-search)?:1\.0\.0/);
    assert.doesNotMatch(text, /prerelease/);
    for (const line of text.split("\n").filter((l) => l.includes("gh attestation verify")))
      for (const flag of ["--signer-workflow", "--source-ref refs/tags/v1.0.0", "--deny-self-hosted-runners"])
        assert.ok(line.includes(flag), line);
  });
  it("says when it is a prerelease, and lists everything when there is no previous final tag", () => {
    const text = notes({ version: "1.0.0-rc.1", prerelease: true, digests: PROD, bases, changes: [], previousTag: undefined });
    assert.match(text, /release candidate \(prerelease\)/);
    assert.match(text, /## Changes\n/);
  });
  it("the CLI uses the previous final tag and caps the change list", () => {
    const dir = scratch();
    const lockFile = join(dir, "lock.json");
    writeFileSync(lockFile, JSON.stringify({ images: PROD }));
    const calls = [];
    const git = (args) => {
      calls.push(args.join(" "));
      if (args[0] === "tag") return ok("v0.9.0\nv1.0.0-rc.1\nv1.1.0\n");
      return ok(Array.from({ length: 60 }, (_, i) => `c${i} change ${i}`).join("\n"));
    };
    const r = notesCommand(["--version", "1.0.0", "--lock", lockFile, "--out", join(dir, "notes.md"), "--max-changes", "50"], git);
    assert.equal(r.previousTag, "v0.9.0");
    assert.ok(calls.includes("log --oneline --no-decorate v0.9.0..v1.0.0"));
    const text = readFileSync(join(dir, "notes.md"), "utf8");
    assert.match(text, /- c49 `change 49`\n- … and 10 more/);
  });
  it("renders each commit subject as one inline code span, so it can't add links, images, HTML, mentions or #refs", () => {
    const evil = "abc1234 feat: [click](https://evil.example) ![x](y) <img src=x onerror=alert(1)> @Nit-1997 #12 `rm -rf` ok";
    assert.equal(
      safeChange(evil),
      "abc1234 ``feat: [click](https://evil.example) ![x](y) <img src=x onerror=alert(1)> @Nit-1997 #12 `rm -rf` ok``",
    );
    assert.equal(safeChange("abc1234 docs(m5): INSTALL warnings"), "abc1234 `docs(m5): INSTALL warnings`");
    assert.equal(safeChange("abc1234 tab\there\u0007"), "abc1234 `tab here`");
    assert.equal(safeChange("abc1234 `a` ``b``"), "abc1234 ``` `a` ``b`` ```");
    assert.equal(safeChange("abc1234 https://evil.example"), "abc1234 `https://evil.example`");
    assert.equal(safeChange("no sha <b>here</b>"), "`no sha <b>here</b>`");
    assert.equal(safeChange("… and 10 more"), "… and 10 more");
    const text = notes({ version: "1.0.0", prerelease: false, digests: PROD, bases, changes: [evil], previousTag: "v0.9.0" });
    const changes = text.slice(text.indexOf("## Changes"));
    assert.ok(changes.includes(`- ${safeChange(evil)}`));
    for (const line of changes.split("\n").filter((l) => l.startsWith("- "))) {
      const m = /^- [0-9a-f]+ (`+)( ?)(.*)\2\1$/.exec(line);
      assert.ok(m, line);
      assert.equal(m[3].includes(m[1]), false, line);
    }
  });
  it("the CLI takes a dry-run version only in test mode", () => {
    const dir = scratch();
    const lockFile = join(dir, "lock.json");
    writeFileSync(lockFile, JSON.stringify({ images: LOCAL }));
    const git = (args) => ok(args[0] === "tag" ? "" : "c1 one\n");
    const argv = ["--version", "0.0.0-dryrun.1", "--lock", lockFile, "--out", join(dir, "notes.md"), "--ref", "HEAD"];
    assert.throws(() => notesCommand(argv, git, {}), /v0\.0\.0-dryrun/);
    assert.equal(notesCommand(argv, git, TEST_ENV).changes, 1);
    assert.throws(() => notesCommand(["--version", "1.0.0-beta.1", "--lock", lockFile, "--out", join(dir, "n.md")], git, TEST_ENV));
  });
});

describe("RELEASE_IMAGES (one table for the image build inputs)", () => {
  it("names the two images, their Dockerfiles, contexts and content folders", () => {
    assert.deepEqual(
      RELEASE_IMAGES.map((i) => [i.key, i.image, i.name, i.dryRunName, i.context, i.dockerfile, i.content]),
      [
        ["agent", "open-agent", "ghcr.io/nit-1997/open-agent", "oab-m5-open-agent", ".", "packages/core/Dockerfile", "/app"],
        [
          "search",
          "open-agent-search",
          "ghcr.io/nit-1997/open-agent-search",
          "oab-m5-open-agent-search",
          "local/searxng",
          "local/searxng/Dockerfile",
          "/opt/open-agent",
        ],
      ],
    );
    for (const i of RELEASE_IMAGES) assert.ok(existsSync(join(ROOT, i.dockerfile)), i.dockerfile);
    assert.ok(Object.isFrozen(RELEASE_IMAGES) && RELEASE_IMAGES.every(Object.isFrozen));
  });
  it("the dry run and notes.mjs read it instead of their own copies", () => {
    assert.deepEqual(
      IMAGES.map((i) => [i.key, i.name, i.context, i.file, i.content]),
      RELEASE_IMAGES.map((i) => [i.key, i.dryRunName, i.context, i.dockerfile, i.content]),
    );
    for (const f of ["scripts/release/dry-run.mjs", "scripts/release/notes.mjs"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.doesNotMatch(src, /packages\/core\/Dockerfile|local\/searxng/, f);
    }
  });
});

describe("dry-run.mjs guards", () => {
  const good = [
    "--version",
    "0.0.0-dryrun.1",
    "--registry",
    "127.0.0.1:18501",
    "--builder",
    "oab-factory-m5-builder",
    "--out",
    join(ROOT, ".factory/m5/test-guard/x"),
  ];
  const problems = (argv, env = TEST_ENV, ctx = {}) => dryRunProblems(parseDryRunArgs(argv), env, { repo: ROOT, dirty: false, ...ctx });
  const swap = (flag, value) => {
    const a = [...good];
    a[a.indexOf(flag) + 1] = value;
    return a;
  };
  it("accepts the documented command", () => assert.deepEqual(problems(good), []));
  it("refuses without test mode", () => assert.match(problems(good, {}).join(), /OPEN_AGENT_SHELL_TEST/));
  it("refuses a non-dryrun version", () => {
    assert.match(problems(swap("--version", "1.0.0")).join(), /0\.0\.0-dryrun/);
    assert.match(problems(swap("--version", "0.0.0-rc.1")).join(), /0\.0\.0-dryrun/);
  });
  it("refuses a registry that is not 127.0.0.1:18xxx", () => {
    for (const r of ["ghcr.io", "localhost:18501", "127.0.0.1:5000", "127.0.0.1:28501"])
      assert.match(problems(swap("--registry", r)).join(), /--registry/);
  });
  it("refuses an --out outside .factory/ or the temp dir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "oab-m5-out-"));
    try {
      const inTmp = (argv) => problems(argv, TEST_ENV, { tmp });
      for (const o of ["/Users/x/out", join(ROOT, "apps/desktop/release"), join(ROOT, ".factory"), join(ROOT, ".factory/../x")])
        assert.match(inTmp(swap("--out", o)).join(), /--out must be under/, o);
      assert.deepEqual(inTmp(swap("--out", join(tmp, "oab-m5-dry"))), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("refuses a missing or non-oab builder", () => {
    assert.match(problems(good.slice(0, 4).concat(good.slice(6))).join(), /--builder/);
    assert.match(problems(swap("--builder", "default")).join(), /oab-/);
  });
  it("refuses a dirty tree without --allow-dirty", () => {
    assert.match(problems(good, TEST_ENV, { dirty: true }).join(), /uncommitted/);
    assert.deepEqual(problems([...good, "--allow-dirty"], TEST_ENV, { dirty: true }), []);
  });
  it("refuses unknown platforms", () => assert.match(problems([...good, "--platforms", "linux/arm/v7"]).join(), /--platforms/));
  it("the CLI exits 2 before touching Docker", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/release/dry-run.mjs"), ...swap("--version", "1.0.0")], {
      encoding: "utf8",
      env: { PATH: "/nonexistent", ...TEST_ENV },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--version must be 0\.0\.0-dryrun/);
  });
  it("draft-release.json and the mock release have the D6 shape", () => {
    assert.deepEqual(draftRelease("0.0.0-dryrun.1", false), {
      tag: "v0.0.0-dryrun.1",
      name: "Open Agent 0.0.0-dryrun.1",
      draft: true,
      prerelease: false,
      notes_file: "notes.md",
      assets: releaseAssets("0.0.0-dryrun.1"),
    });
    const m = mockRelease("0.0.0-dryrun.2", Buffer.from("{}")).latest;
    assert.equal(m.tag_name, "v0.0.0-dryrun.2");
    assert.equal(m.draft, false);
    assert.equal(m.prerelease, false);
    assert.equal(m.assets[0].browser_download_url, "{{ORIGIN}}/assets/open-agent-services.json");
  });
});
