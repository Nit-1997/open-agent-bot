#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { isMain, main, REPO } from "./cli.mjs";
import { mergeDigest } from "./image-checks.mjs";
import { DRY_RUN_VERSION, MANIFEST_NAME, releaseAssets, SUMS_NAME, sha256Hex, stableJson } from "./releaseLib.mjs";

export const IMAGES = Object.freeze([
  { key: "agent", name: "oab-m5-open-agent", context: ".", file: "packages/core/Dockerfile", content: "/app" },
  {
    key: "search",
    name: "oab-m5-open-agent-search",
    context: "local/searxng",
    file: "local/searxng/Dockerfile",
    content: "/opt/open-agent",
  },
]);
const PLATFORMS = new Set(["linux/arm64", "linux/amd64"]);
const REGISTRY = /^127\.0\.0\.1:18\d{3}$/;
const OAB = /^oab-[a-z0-9-]+$/;
const MAX_MANIFEST = 64 * 1024;
const APP = join(REPO, "apps/desktop");
const RELEASE_SCRIPTS = join(REPO, "scripts/release");

const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
const realOrParent = (p) => {
  let cur = p;
  const rest = [];
  while (!existsSync(cur)) {
    rest.unshift(cur.slice(dirname(cur).length + 1));
    cur = dirname(cur);
  }
  return join(realpathSync(cur), ...rest);
};

export function parseDryRunArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: "string" },
      registry: { type: "string" },
      builder: { type: "string" },
      out: { type: "string" },
      platforms: { type: "string", default: "linux/arm64,linux/amd64" },
      "services-only": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  return {
    version: values.version,
    registry: values.registry,
    builder: values.builder,
    out: values.out ? resolve(values.out) : undefined,
    platforms: values.platforms.split(",").filter(Boolean),
    servicesOnly: values["services-only"],
    allowDirty: values["allow-dirty"],
  };
}

export function dryRunProblems(o, env, ctx) {
  const out = [];
  if (env.OPEN_AGENT_SHELL_TEST !== "1") out.push("the dry run needs OPEN_AGENT_SHELL_TEST=1");
  if (!DRY_RUN_VERSION.test(o.version ?? "")) out.push(`--version must be 0.0.0-dryrun.<n>, got ${o.version}`);
  if (!REGISTRY.test(o.registry ?? "")) out.push(`--registry must be 127.0.0.1:18xxx, got ${o.registry}`);
  if (!o.builder) out.push("--builder <buildx builder> is required (the dry run never creates one)");
  else if (!OAB.test(o.builder)) out.push(`--builder must be an oab- name, got ${o.builder}`);
  if (!o.out) out.push("--out <dir> is required");
  else {
    const real = realOrParent(o.out);
    const roots = [realOrParent(join(ctx.repo, ".factory")), realpathSync(ctx.tmp ?? tmpdir())];
    if (!roots.some((r) => within(real, r) && real !== r)) out.push(`--out must be under ${roots.join(" or ")}, got ${o.out}`);
    else if (existsSync(o.out) && readdirSync(o.out).length) out.push(`--out ${o.out} is not empty`);
  }
  if (!o.platforms.length || o.platforms.some((p) => !PLATFORMS.has(p)))
    out.push(`--platforms must be a subset of linux/arm64,linux/amd64, got ${o.platforms.join(",")}`);
  if (ctx.dirty && !o.allowDirty) out.push("tracked files have uncommitted changes (commit them or pass --allow-dirty)");
  for (const i of IMAGES) if (!i.name.startsWith("oab-")) out.push(`image name ${i.name} does not start with oab-`);
  return out;
}

export function checkMountedApp(mount, { lockSha256, version }) {
  const out = [];
  const apps = readdirSync(mount).filter((n) => n.endsWith(".app"));
  if (apps.length !== 1 || apps[0] !== "Open Agent.app")
    return [`the DMG must hold exactly one Open Agent.app, found [${apps.join(", ")}]`];
  const app = join(mount, "Open Agent.app");
  const lock = join(app, "Contents/Resources/stack/services.lock.json");
  let st;
  try {
    st = lstatSync(lock);
  } catch {
    return ["Contents/Resources/stack/services.lock.json is missing"];
  }
  if (st.isSymbolicLink() || !st.isFile()) return ["Contents/Resources/stack/services.lock.json is not a regular file"];
  const shasum = spawnSync("shasum", ["-a", "256", lock], { encoding: "utf8" });
  const got = shasum.stdout.split(/\s/)[0];
  if (shasum.status !== 0) out.push(`shasum exited ${shasum.status}`);
  else if (got !== lockSha256) out.push(`the bundled lock sha256 ${got} differs from the lock step's ${lockSha256}`);
  const plist = spawnSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", join(app, "Contents/Info.plist")], {
    encoding: "utf8",
  });
  if (plist.status !== 0) out.push(`plutil exited ${plist.status}: ${plist.stderr.trim()}`);
  else if (plist.stdout.trim() !== version) out.push(`CFBundleShortVersionString is ${plist.stdout.trim()}, expected ${version}`);
  return out;
}

export function verifyDmg(dmg, expect, scratch) {
  const mount = mkdtempSync(join(scratch, "m-"));
  const attach = spawnSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmg], { encoding: "utf8" });
  if (attach.status !== 0) return [`hdiutil attach exited ${attach.status}: ${attach.stderr.trim()}`];
  try {
    return checkMountedApp(mount, expect);
  } finally {
    spawnSync("hdiutil", ["detach", mount], { encoding: "utf8" });
    rmSync(mount, { recursive: true, force: true });
  }
}

export function mockRelease(version, manifestBytes) {
  return {
    latest: {
      tag_name: `v${version}`,
      name: `Open Agent ${version}`,
      draft: false,
      prerelease: false,
      html_url: `https://github.com/Nit-1997/open-agent-bot/releases/tag/v${version}`,
      assets: [{ name: MANIFEST_NAME, size: manifestBytes.length, browser_download_url: `{{ORIGIN}}/assets/${MANIFEST_NAME}` }],
    },
  };
}

export function draftRelease(version, prerelease) {
  return {
    tag: `v${version}`,
    name: `Open Agent ${version}`,
    draft: true,
    prerelease,
    notes_file: "notes.md",
    assets: releaseAssets(version),
  };
}

class StepFailed extends Error {}

function runner(log) {
  const say = (m) => {
    process.stdout.write(`${m}\n`);
    log.push(m);
  };
  const step = (label, cmd, args, o = {}) => {
    say(`[dry-run ${label}] ${[cmd, ...args].map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    const r = spawnSync(cmd, args, {
      cwd: o.cwd ?? REPO,
      env: o.env ?? process.env,
      encoding: o.capture === "buffer" ? "buffer" : "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: o.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    });
    const status = r.error ? 127 : r.status;
    if (o.capture && r.stderr?.length) process.stderr.write(r.stderr);
    say(`[dry-run ${label}] exit ${status}${r.error ? ` (${r.error.message})` : ""}`);
    if (status !== 0 && !o.allowFail) throw new StepFailed(`${label} exited ${status}`);
    return { status, stdout: r.stdout };
  };
  const node = (label, script, args, o) => step(label, process.execPath, [script, ...args], o);
  return { say, step, node };
}

export async function dryRun(o) {
  const log = [];
  const { say, step, node } = runner(log);
  const lockDir = join(o.out, "lock");
  const pushDir = join(o.out, "push");
  mkdirSync(lockDir, { recursive: true });
  mkdirSync(pushDir, { recursive: true });
  const rel = (p) => relative(REPO, p);
  const script = (n) => join(RELEASE_SCRIPTS, n);
  const tag = `v${o.version}`;
  const hostPlatform = process.arch === "arm64" ? "linux/arm64" : "linux/amd64";
  const docker = (label, args, opts) => step(label, "docker", args, opts);

  const inspect = docker("setup/builder", ["buildx", "inspect", o.builder], { capture: true, allowFail: true });
  if (inspect.status !== 0 || !/^Driver:\s+docker-container$/m.test(inspect.stdout))
    throw new StepFailed(`builder ${o.builder} must exist and use the docker-container driver`);

  node("gate/version", script("version.mjs"), [tag, "--dry-run"]);
  node("gate/checks", script("gate.mjs"), ["--tag", tag, "--dry-run"]);
  const revision = step("gate/revision", "git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim();

  const refs = {};
  const pulled = [];
  const pull = (label, ref, platform) => {
    docker(label, ["pull", "--quiet", "--platform", platform, ref]);
    pulled.push(ref);
  };
  const dropPulled = () => {
    for (const ref of pulled.splice(0)) {
      const id = spawnSync("docker", ["image", "inspect", ref, "--format", "{{.Id}}"], { encoding: "utf8" }).stdout.trim();
      docker("cleanup/image-rm", ["image", "rm", ref], { capture: true, allowFail: true });
      if (id && spawnSync("docker", ["image", "inspect", id], { encoding: "utf8" }).status === 0)
        docker("cleanup/image-rm-id", ["image", "rm", id], { capture: true, allowFail: true });
    }
  };

  try {
    for (const img of IMAGES) {
      const repo = `${o.registry}/${img.name}`;
      const meta = join(pushDir, `${img.name}-metadata.json`);
      docker(`push/build-${img.key}`, [
        "buildx",
        "build",
        "--builder",
        o.builder,
        "--platform",
        o.platforms.join(","),
        "--provenance",
        "mode=max",
        "--sbom",
        "true",
        "--build-arg",
        `OPEN_AGENT_VERSION=${o.version}`,
        "--build-arg",
        `OPEN_AGENT_REVISION=${revision}`,
        "--metadata-file",
        meta,
        "--push",
        "-t",
        `${repo}:${o.version}`,
        "-f",
        img.file,
        img.context,
      ]);
      node(`push/digest-${img.key}`, script("image-checks.mjs"), ["merge-digest", "--metadata", meta, "--name", repo]);
      refs[img.key] = `${repo}@${mergeDigest({ metadata: readFileSync(meta, "utf8") })}`;
      pull(`push/pull-${img.key}`, refs[img.key], hostPlatform);
      node(`push/content-${img.key}`, script("image-checks.mjs"), ["content", "--image", refs[img.key], "--dir", img.content]);
      node(`push/labels-${img.key}`, script("image-checks.mjs"), [
        "labels",
        "--image",
        refs[img.key],
        "--version",
        o.version,
        "--revision",
        revision,
      ]);
      dropPulled();
    }

    for (const img of IMAGES) {
      const repo = `${o.registry}/${img.name}`;
      const raw = join(lockDir, `raw-${img.key}.json`);
      const got = docker(`lock/inspect-${img.key}`, ["buildx", "imagetools", "inspect", "--builder", o.builder, refs[img.key], "--raw"], {
        capture: "buffer",
      });
      writeFileSync(raw, got.stdout);
      const tagJson = docker(
        `lock/tag-${img.key}`,
        ["buildx", "imagetools", "inspect", "--builder", o.builder, `${repo}:${o.version}`, "--format", "{{json .Manifest}}"],
        { capture: true },
      );
      const tagDigest = mergeDigest({ inspectJson: tagJson.stdout });
      node(`lock/verify-index-${img.key}`, script("verify-index.mjs"), [
        "--ref",
        refs[img.key],
        "--version",
        o.version,
        "--raw",
        raw,
        "--tag-digest",
        tagDigest,
      ]);
    }
    for (const platform of o.platforms) {
      pull(`lock/pull-agent-${platform}`, refs.agent, platform);
      node(`lock/node-${platform}`, script("image-checks.mjs"), ["node", "--image", refs.agent, "--platform", platform]);
      dropPulled();
    }
    for (const img of IMAGES) {
      node(`lock/labels-${img.key}`, script("image-checks.mjs"), [
        "labels",
        "--image",
        refs[img.key],
        "--version",
        o.version,
        "--revision",
        revision,
        "--pull",
        "--platform",
        hostPlatform,
      ]);
      pulled.push(refs[img.key]);
      dropPulled();
    }
    say("[dry-run lock/attestation-verify] SKIPPED (dry run: no GitHub OIDC; release.yml runs it before writing the lock)");
    const lockFile = join(lockDir, "services.lock.json");
    const manifestFile = join(lockDir, MANIFEST_NAME);
    node("lock/write-lock", script("write-lock.mjs"), [
      "--version",
      o.version,
      "--agent",
      refs.agent,
      "--search",
      refs.search,
      "--out-lock",
      lockFile,
      "--out-manifest",
      manifestFile,
      "--dry-run",
    ]);
    node("lock/assert-lock", script("assert-lock.mjs"), [lockFile, "--version", o.version, "--dry-run"]);
    const manifestBytes = readFileSync(manifestFile);
    if (manifestBytes.length > MAX_MANIFEST) throw new StepFailed(`${MANIFEST_NAME} is ${manifestBytes.length} bytes, over 64 KiB`);
    say(`[dry-run lock/manifest] ${rel(manifestFile)} ${manifestBytes.length} bytes`);
    node("lock/notes", script("notes.mjs"), [
      "--version",
      o.version,
      "--lock",
      lockFile,
      "--out",
      join(lockDir, "notes.md"),
      "--ref",
      "HEAD",
      "--max-changes",
      "50",
    ]);

    const mock = join(o.out, "mock-release");
    mkdirSync(join(mock, "assets"), { recursive: true });
    writeFileSync(join(mock, "latest.json"), stableJson(mockRelease(o.version, manifestBytes).latest));
    copyFileSync(manifestFile, join(mock, "assets", MANIFEST_NAME));
    say(`[dry-run release/mock-release] ${rel(mock)}`);
    if (o.servicesOnly) {
      say("[dry-run desktop] SKIPPED (--services-only)");
      return { refs, log };
    }

    const lockSha256 = sha256Hex(readFileSync(lockFile));
    const dmgDir = join(o.out, "dmgs");
    mkdirSync(dmgDir, { recursive: true });
    const names = { arm64: `Open-Agent-${o.version}-arm64.dmg`, x64: `Open-Agent-${o.version}-x64.dmg` };
    const builtDmg = (arch) => join(APP, "release", names[arch]);
    for (const arch of ["arm64", "x64"]) rmSync(builtDmg(arch), { force: true });
    try {
      node("desktop/stage", join(APP, "scripts/stage-stack.mjs"), ["--lock", lockFile]);
      node("desktop/build", join(APP, "scripts/build.mjs"), []);
      step(
        "desktop/electron-builder",
        join(REPO, "node_modules/.bin/electron-builder"),
        ["--mac", "--arm64", "--x64", "--publish", "never", `--config.extraMetadata.version=${o.version}`],
        { cwd: APP, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } },
      );
      for (const arch of ["arm64", "x64"])
        if (!existsSync(builtDmg(arch)))
          throw new StepFailed(`electron-builder did not write ${rel(builtDmg(arch))} (artifactName vs extraMetadata)`);
      node("desktop/packaged-smoke", join(APP, "scripts/packagedSmoke.mjs"), [
        "--release",
        o.version,
        "--expect-lock",
        lockFile,
        "--app",
        join(APP, "release/mac-arm64/Open Agent.app"),
        "--app",
        join(APP, "release/mac/Open Agent.app"),
        "--dmg",
        builtDmg("arm64"),
        "--dmg",
        builtDmg("x64"),
        "--evidence",
        join(o.out, "smoke"),
      ]);
      for (const arch of ["arm64", "x64"]) copyFileSync(builtDmg(arch), join(dmgDir, names[arch]));
    } finally {
      node("desktop/restage", join(APP, "scripts/stage-stack.mjs"), [], { allowFail: true });
    }

    const scratch = mkdtempSync(join(tmpdir(), "oab-m5-verify-"));
    try {
      for (const arch of ["arm64", "x64"]) {
        say(`[dry-run verify-dmgs/${arch}] hdiutil attach -nobrowse -readonly ${rel(join(dmgDir, names[arch]))}`);
        const bad = verifyDmg(join(dmgDir, names[arch]), { lockSha256, version: o.version }, scratch);
        for (const b of bad) say(`[dry-run verify-dmgs/${arch}] ${b}`);
        say(`[dry-run verify-dmgs/${arch}] exit ${bad.length ? 1 : 0}`);
        if (bad.length) throw new StepFailed(`verify-dmgs ${arch} failed`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

    const attestDir = join(o.out, "attest");
    mkdirSync(attestDir, { recursive: true });
    symlinkSync(manifestFile, join(attestDir, MANIFEST_NAME));
    for (const arch of ["arm64", "x64"]) symlinkSync(join(dmgDir, names[arch]), join(attestDir, names[arch]));
    node("attest/sums", script("sums.mjs"), [attestDir, "--version", o.version]);
    say("[dry-run attest/attest-build-provenance] SKIPPED (dry run: no GitHub OIDC)");

    const releaseDir = join(o.out, "release");
    mkdirSync(releaseDir, { recursive: true });
    copyFileSync(manifestFile, join(releaseDir, MANIFEST_NAME));
    for (const arch of ["arm64", "x64"]) copyFileSync(join(dmgDir, names[arch]), join(releaseDir, names[arch]));
    copyFileSync(join(attestDir, SUMS_NAME), join(releaseDir, SUMS_NAME));
    const assets = readdirSync(releaseDir).sort();
    if (JSON.stringify(assets) !== JSON.stringify(releaseAssets(o.version)))
      throw new StepFailed(`release/ holds [${assets.join(", ")}], expected [${releaseAssets(o.version).join(", ")}]`);
    step("release/shasum", "shasum", ["-a", "256", "-c", SUMS_NAME], { cwd: releaseDir });
    copyFileSync(join(lockDir, "notes.md"), join(releaseDir, "notes.md"));
    writeFileSync(join(releaseDir, "draft-release.json"), stableJson(draftRelease(o.version, false)));
    for (const a of assets) say(`[dry-run release/asset] ${a} ${statSync(join(releaseDir, a)).size} bytes`);
    say(`[dry-run release/draft] ${rel(join(releaseDir, "draft-release.json"))} draft=true prerelease=false`);
    return { refs, log };
  } finally {
    dropPulled();
    writeFileSync(join(o.out, "dry-run.log"), `${log.join("\n")}\n`);
  }
}

if (isMain(import.meta.url))
  main("dry-run", async () => {
    const o = parseDryRunArgs(process.argv.slice(2));
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: REPO, encoding: "utf8" });
    const problems = dryRunProblems(o, process.env, { repo: REPO, dirty: status.status !== 0 || status.stdout.trim() !== "" });
    if (problems.length) {
      for (const p of problems) process.stderr.write(`dry-run: ${p}\n`);
      return 2;
    }
    mkdirSync(o.out, { recursive: true });
    try {
      const r = await dryRun(o);
      process.stdout.write(`dry-run: ok ${o.version} agent=${r.refs.agent} search=${r.refs.search}\n`);
      return 0;
    } catch (e) {
      if (!(e instanceof StepFailed)) throw e;
      process.stderr.write(`dry-run: FAILED: ${e.message}\n`);
      return 1;
    }
  });
