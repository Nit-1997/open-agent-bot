#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkFuses, checkPlist, parseFuses, sizeProblems } from "./packagedSmokeLib.mjs";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP_DIR, "../..");
const { values } = parseArgs({
  options: { app: { type: "string", multiple: true }, dmg: { type: "string", multiple: true }, static: { type: "boolean" } },
});
if (!values.static) {
  process.stderr.write("packaged smoke: only --static is available until 4.5 adds the launch steps\n");
  process.exit(2);
}
const apps = values.app ?? [];
if (apps.length === 0) {
  process.stderr.write("packaged smoke: pass --app <path to .app> at least once\n");
  process.exit(2);
}

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const du = (p) => walk(p).reduce((n, f) => n + (lstatSync(f).isFile() ? lstatSync(f).size : 0), 0);
const version = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")).version;
const EXPECTED_ARCH = { "mac-arm64": "arm64", mac: "x86_64" };
const dmgFor = (arch) => (values.dmg ?? []).find((d) => d.endsWith(`-${arch === "x86_64" ? "x64" : arch}.dmg`));

const problems = [];
for (const appPath of apps) {
  const name = relative(process.cwd(), appPath);
  const p = (msg) => problems.push(`${name}: ${msg}`);
  if (!existsSync(appPath)) {
    p("does not exist");
    continue;
  }
  const fuses = run(process.execPath, [join(REPO, "node_modules/@electron/fuses/dist/bin.js"), "read", "--app", appPath]);
  if (fuses.status !== 0) p(`@electron/fuses read exited ${fuses.status}: ${fuses.stderr.trim()}`);
  for (const f of checkFuses(parseFuses(fuses.stdout))) p(f);

  const plistJson = run("plutil", ["-convert", "json", "-o", "-", join(appPath, "Contents/Info.plist")]);
  if (plistJson.status !== 0) p(`plutil exited ${plistJson.status}`);
  else for (const f of checkPlist(JSON.parse(plistJson.stdout), version)) p(f);

  const lipo = run("lipo", ["-archs", join(appPath, "Contents/MacOS/Open Agent")]);
  const arch = lipo.stdout.trim();
  const want = EXPECTED_ARCH[dirname(appPath).split("/").pop()];
  if (lipo.status !== 0) p(`lipo exited ${lipo.status}`);
  else if (want && arch !== want) p(`lipo -archs is ${arch}, expected ${want}`);

  const sign = run("codesign", ["--verify", "--deep", "--strict", appPath]);
  if (sign.status !== 0) p(`codesign --verify --deep --strict exited ${sign.status}: ${sign.stderr.trim()}`);

  const stack = join(appPath, "Contents/Resources/stack");
  const staged = existsSync(stack)
    ? walk(stack)
        .map((f) => relative(stack, f))
        .sort()
    : [];
  const wantStaged = ["docker-compose.yml", "local/renderer/seccomp.json", "services.lock.json"];
  if (JSON.stringify(staged) !== JSON.stringify(wantStaged))
    p(`Resources/stack holds ${JSON.stringify(staged)}, expected ${JSON.stringify(wantStaged)}`);
  else {
    const composeSha = sha(join(stack, "docker-compose.yml"));
    if (composeSha !== sha(join(REPO, "docker-compose.yml"))) p("Resources/stack/docker-compose.yml differs from the repo root");
    if (sha(join(stack, "local/renderer/seccomp.json")) !== sha(join(REPO, "local/renderer/seccomp.json")))
      p("Resources/stack seccomp.json differs from the repo root");
    const lock = JSON.parse(readFileSync(join(stack, "services.lock.json"), "utf8"));
    if (lock.composeSha256 !== composeSha) p("services.lock.json composeSha256 differs from the bundled compose file");
    process.stdout.write(
      `${name}: compose sha256 ${composeSha}\n${name}: seccomp sha256 ${sha(join(stack, "local/renderer/seccomp.json"))}\n`,
    );
  }
  const envFiles = walk(appPath).filter((f) => /(^|\/)\.env/.test(relative(appPath, f)));
  if (envFiles.length) p(`contains env files: ${envFiles.map((f) => relative(appPath, f)).join(", ")}`);

  const sizes = { app: du(appPath), asar: statSync(join(appPath, "Contents/Resources/app.asar")).size, dmg: undefined };
  const dmg = dmgFor(arch);
  if (dmg) sizes.dmg = statSync(dmg).size;
  for (const s of sizeProblems(sizes)) p(s);
  process.stdout.write(
    `${name}: arch ${arch}; app ${sizes.app} bytes; app.asar ${sizes.asar} bytes${dmg ? `; ${relative(process.cwd(), dmg)} ${sizes.dmg} bytes` : ""}\n`,
  );
}

if (problems.length) {
  for (const p of problems) process.stderr.write(`packaged smoke: ${p}\n`);
  process.exit(1);
}
process.stdout.write("packaged smoke: ok\n");
