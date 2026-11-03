import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { sha256Hex } from "../release/releaseLib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "scripts/test/fixtures/release");
const wf = parse(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8"));
const SHA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const TAG = "v1.0.0-rc.1";
const VERSION = "1.0.0-rc.1";
const RAW = readFileSync(join(FIX, "index-good.json"));
const INDEX = `sha256:${sha256Hex(RAW)}`;
const SIGNER = `https://github.com/Nit-1997/open-agent-bot/.github/workflows/release.yml@refs/tags/${TAG}`;
const GATE = { version: VERSION, prerelease: "true", tag: TAG };

const work = mkdtempSync(join(tmpdir(), "oab-m5-wfrun-"));
after(() => rmSync(work, { recursive: true, force: true }));
const store = join(work, "artifacts");

const resolve = (value, ctx) =>
  String(value).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    let m = /^steps\.([\w-]+)\.outputs\.(\w+)$/.exec(expr);
    if (m) return ctx.outputs[m[1]]?.[m[2]] ?? "";
    m = /^needs\.gate\.outputs\.(\w+)$/.exec(expr);
    if (m) return GATE[m[1]];
    m = /^matrix\.(\w+)$/.exec(expr);
    if (m) return ctx.matrix[m[1]];
    if (expr === "runner.temp") return ctx.temp;
    if (expr === "github.token") return "test-token";
    if (expr === "github.sha") return SHA;
    throw new Error(`unresolved expression ${expr}`);
  });

function upload(step, ctx) {
  const name = resolve(step.with.name, ctx);
  const dest = join(store, name);
  mkdirSync(dest, { recursive: true });
  for (const p of resolve(step.with.path, ctx).trim().split("\n")) {
    const src = p.startsWith("/") ? p : join(ctx.cwd, p);
    assert.ok(existsSync(src), `upload ${name}: ${src} is missing`);
    if (statSync(src).isDirectory()) cpSync(src, dest, { recursive: true });
    else cpSync(src, join(dest, basename(src)));
  }
}

function download(step, ctx) {
  const path = resolve(step.with.path, ctx);
  mkdirSync(path, { recursive: true });
  const names = step.with.name
    ? [resolve(step.with.name, ctx)]
    : readdirSync(store).filter((n) => new RegExp(`^${resolve(step.with.pattern, ctx).replace("*", ".*")}$`).test(n));
  assert.ok(names.length > 0, `download ${step.with.name ?? step.with.pattern}: nothing uploaded`);
  for (const n of names) {
    assert.ok(existsSync(join(store, n)), `download ${n}: not uploaded`);
    cpSync(join(store, n), step.with.name || step.with["merge-multiple"] ? path : join(path, n), { recursive: true });
  }
}

const attestationResult = (ref) => [
  {
    verificationResult: {
      statement: { subject: [{ name: ref.slice(0, ref.lastIndexOf("@")), digest: { sha256: ref.slice(ref.lastIndexOf("@") + 8) } }] },
      signature: {
        certificate: {
          buildSignerURI: SIGNER,
          sourceRepositoryURI: "https://github.com/Nit-1997/open-agent-bot",
          sourceRepositoryRef: `refs/tags/${TAG}`,
          sourceRepositoryDigest: SHA,
          runnerEnvironment: "github-hosted",
        },
      },
    },
  },
];

function emulate(line, env) {
  const target = /> "([^"]+)"$/.exec(line)?.[1]?.replace(/\$(\w+)/g, (_, v) => env[v]);
  if (/^docker buildx imagetools create --metadata-file/.test(line)) {
    for (const ref of [env.AMD64, env.ARM64]) assert.match(ref, /^ghcr\.io\/nit-1997\/open-agent(-search)?@sha256:[0-9a-f]{64}$/);
    assert.match(env.VERSION_TAG, new RegExp(`:${VERSION.replace(/\./g, "\\.")}$`));
    assert.match(env.SHA_TAG, new RegExp(`:sha-${SHA.slice(0, 7)}$`));
    writeFileSync(join(env.RUNNER_TEMP, "index-metadata.json"), JSON.stringify({ "containerimage.descriptor": { digest: INDEX } }));
    return "emulated";
  }
  if (/^docker buildx imagetools inspect "\$\w+" --raw >/.test(line)) {
    writeFileSync(target, RAW);
    return "emulated";
  }
  if (/^docker buildx imagetools inspect "\$\w+_TAG" --format/.test(line)) {
    writeFileSync(target, JSON.stringify({ digest: INDEX }));
    return "emulated";
  }
  if (/^gh attestation verify "oci:\/\/\$(AGENT|SEARCH)"/.test(line)) {
    const ref = line.includes("$AGENT") ? env.AGENT : env.SEARCH;
    writeFileSync(target, JSON.stringify(attestationResult(ref)));
    return "emulated";
  }
  if (/^node scripts\/release\/image-checks\.mjs (node|labels|content) /.test(line)) return "skipped (needs the pushed image; unit-tested)";
  if (/^(docker|gh) /.test(line)) return "skipped (needs GitHub or the registry)";
  return undefined;
}

function runJob(name, { matrix = {}, outputs = {}, only = () => true } = {}) {
  const job = wf.jobs[name];
  const temp = mkdtempSync(join(work, `${name}-`));
  const ctx = { outputs: { ...outputs }, matrix, temp, cwd: ROOT };
  const log = [];
  for (const step of job.steps.filter(only)) {
    const uses = String(step.uses ?? "");
    if (uses.startsWith("actions/upload-artifact@")) upload(step, ctx);
    else if (uses.startsWith("actions/download-artifact@")) download(step, ctx);
    if (!step.run) continue;
    const out = join(temp, `output-${log.length}`);
    const env = { PATH: process.env.PATH, HOME: work, RUNNER_TEMP: temp, GITHUB_SHA: SHA, GITHUB_OUTPUT: out };
    for (const [k, v] of Object.entries({ ...(job.env ?? {}), ...(step.env ?? {}) })) env[k] = resolve(v, ctx);
    const line = step.run.trim();
    const emulated = emulate(line, env);
    if (emulated !== undefined) {
      log.push(`${emulated}: ${line}`);
      continue;
    }
    const cwd = step["working-directory"] ? resolve(step["working-directory"], ctx) : ROOT;
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], { cwd, env, encoding: "utf8" });
    assert.equal(r.status, 0, `${name}: ${line}\n${r.stdout}\n${r.stderr}`);
    log.push(`ran: ${line}`);
    if (step.id && existsSync(out))
      ctx.outputs[step.id] = Object.fromEntries(
        readFileSync(out, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );
  }
  return { ctx, log };
}

describe("release.yml script steps run in order against fixtures (push record → merge → lock → attest)", () => {
  it("push legs record per-arch digests into digests-<image>-<arch>", () => {
    let n = 0;
    const only = (st) => st.run?.includes("refs.mjs record") || String(st.uses).startsWith("actions/upload-artifact@");
    for (const leg of wf.jobs.push.strategy.matrix.include) {
      const { log } = runJob("push", { matrix: leg, outputs: { build: { digest: `sha256:${String(++n).repeat(64)}` } }, only });
      assert.ok(log.some((l) => l.startsWith("ran: node scripts/release/refs.mjs record")));
    }
    assert.deepEqual(readdirSync(store).sort(), [
      "digests-open-agent-amd64",
      "digests-open-agent-arm64",
      "digests-open-agent-search-amd64",
      "digests-open-agent-search-arm64",
    ]);
    assert.equal(readFileSync(join(store, "digests-open-agent-search-arm64/arm64"), "utf8"), `sha256:${"4".repeat(64)}\n`);
  });

  it("merge legs compute the tags with refs.mjs and write index-<image> with merge-digest --out", () => {
    for (const leg of wf.jobs.merge.strategy.matrix.include) {
      const { ctx, log } = runJob("merge", { matrix: leg });
      assert.equal(ctx.outputs.inputs.version_tag, `${leg.name}:${VERSION}`);
      assert.equal(ctx.outputs.inputs.sha_tag, `${leg.name}:sha-${SHA.slice(0, 7)}`);
      assert.equal(ctx.outputs.merge.digest, INDEX);
      assert.ok(log.some((l) => l.startsWith("emulated: docker buildx imagetools create")));
    }
    assert.deepEqual(JSON.parse(readFileSync(join(store, "index-open-agent/open-agent.json"), "utf8")), {
      name: "ghcr.io/nit-1997/open-agent",
      digest: INDEX,
    });
  });

  it("lock verifies both indexes, turns the verification results into attested.json and writes release-lock", () => {
    const { log } = runJob("lock");
    const ran = log.filter((l) => l.startsWith("ran: ")).map((l) => l.slice(5).split(" ").slice(0, 3).join(" "));
    assert.deepEqual(ran, [
      "node scripts/release/refs.mjs lock-inputs",
      "node scripts/release/image-checks.mjs merge-digest",
      "node scripts/release/verify-index.mjs --ref",
      "node scripts/release/image-checks.mjs merge-digest",
      "node scripts/release/verify-index.mjs --ref",
      "node scripts/release/attested.mjs --tag",
      "node scripts/release/write-lock.mjs --version",
      'node scripts/release/assert-lock.mjs "$RUNNER_TEMP/release-lock/services.lock.json"',
      "node scripts/release/notes.mjs --version",
    ]);
    const files = readdirSync(join(store, "release-lock")).sort();
    assert.deepEqual(files, [
      "attested.json",
      "notes.md",
      "open-agent-services.json",
      "raw-agent.json",
      "raw-search.json",
      "services.lock.json",
    ]);
    const lock = JSON.parse(readFileSync(join(store, "release-lock/services.lock.json"), "utf8"));
    assert.equal(lock.kind, "release");
    assert.equal(lock.version, VERSION);
    assert.deepEqual(lock.images, { agent: `ghcr.io/nit-1997/open-agent@${INDEX}`, search: `ghcr.io/nit-1997/open-agent-search@${INDEX}` });
    const manifest = JSON.parse(readFileSync(join(store, "release-lock/open-agent-services.json"), "utf8"));
    assert.equal(manifest.minShellVersion, "0.0.0");
    assert.match(
      readFileSync(join(store, "release-lock/notes.md"), "utf8"),
      /--signer-workflow Nit-1997\/open-agent-bot\/\.github\/workflows\/release\.yml/,
    );
  });

  it("attest's sha256sum line over release-lock + release-dmgs equals sums.mjs on the same files", () => {
    mkdirSync(join(store, "release-dmgs"), { recursive: true });
    for (const arch of ["arm64", "x64"])
      writeFileSync(join(store, "release-dmgs", `Open-Agent-${VERSION}-${arch}.dmg`), `fake ${arch} dmg\n`);
    const { ctx } = runJob("attest");
    const sums = readFileSync(join(ctx.temp, "assets/SHA256SUMS"), "utf8");
    const check = mkdtempSync(join(work, "sums-"));
    for (const f of [`Open-Agent-${VERSION}-arm64.dmg`, `Open-Agent-${VERSION}-x64.dmg`])
      cpSync(join(store, "release-dmgs", f), join(check, f));
    cpSync(join(store, "release-lock/open-agent-services.json"), join(check, "open-agent-services.json"));
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/release/sums.mjs"), check, "--version", VERSION], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(check, "SHA256SUMS"), "utf8"), sums);
    assert.deepEqual(readdirSync(join(store, "release-sums")), ["SHA256SUMS"]);
  });
});
