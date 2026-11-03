#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { COMPOSE_FILE, isMain, main, POLICY_FILE } from "./cli.mjs";
import {
  assertReleaseLock,
  attestedProblems,
  buildLock,
  buildManifest,
  checkPolicy,
  composeSha256,
  modeProblems,
  refProblems,
  stableJson,
} from "./releaseLib.mjs";

export function writeLock(argv, env, o = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: "string" },
      agent: { type: "string" },
      search: { type: "string" },
      "out-lock": { type: "string" },
      "out-manifest": { type: "string" },
      attested: { type: "string" },
      "dry-run": { type: "boolean" },
      policy: { type: "string" },
    },
  });
  for (const k of ["version", "agent", "search", "out-lock", "out-manifest"]) if (!values[k]) throw new Error(`pass --${k}`);
  const dryRun = values["dry-run"] === true;
  const problems = modeProblems({ dryRun, attested: values.attested, version: values.version, env });
  const images = { agent: values.agent, search: values.search };
  problems.push(...refProblems(images, { dryRun }));
  if (values.attested && problems.length === 0)
    problems.push(...attestedProblems(images, JSON.parse(readFileSync(values.attested, "utf8"))));
  const policy = JSON.parse(readFileSync(values.policy ?? POLICY_FILE, "utf8"));
  problems.push(...checkPolicy(policy, values.version));
  if (problems.length) throw new Error(problems.join("; "));
  const compose = o.composeSha256 ?? composeSha256(COMPOSE_FILE);
  const lock = buildLock({ version: values.version, composeSha256: compose, ...images });
  const manifest = buildManifest(lock, policy.minShellVersion);
  if (manifest.version !== lock.version) throw new Error("manifest version differs from the lock version");
  const bad = assertReleaseLock(lock, { version: values.version, composeSha256: compose, dryRun });
  if (bad.length) throw new Error(bad.join("; "));
  for (const [file, value] of [
    [values["out-lock"], lock],
    [values["out-manifest"], manifest],
  ]) {
    const path = resolve(file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stableJson(value), { mode: 0o644 });
    chmodSync(path, 0o644);
  }
  return { lock, manifest };
}

if (isMain(import.meta.url))
  main("write-lock", () => {
    const { lock } = writeLock(process.argv.slice(2), process.env);
    process.stdout.write(`write-lock: kind=${lock.kind} version=${lock.version} agent=${lock.images.agent} search=${lock.images.search}\n`);
    return 0;
  });
