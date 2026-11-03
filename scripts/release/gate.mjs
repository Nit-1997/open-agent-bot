#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { COMPOSE_FILE, isMain, main, POLICY_FILE, REPO, spawnRunner, writeOutputs } from "./cli.mjs";
import { checkPolicy, composeSha256, parseTag } from "./releaseLib.mjs";

const LOCK_FILE = `${REPO}/apps/desktop/services.lock.json`;

export function releaseState(r) {
  if (r.status === 0) return { state: "found" };
  const text = `${r.stderr ?? ""}`.trim();
  if (/^release not found$/m.test(text)) return { state: "absent" };
  return { state: "error", message: text || `gh release view exited ${r.status}` };
}

export function localChecks({ tag, dryRun, read, composeSha = () => composeSha256(COMPOSE_FILE) }) {
  const problems = [];
  const p = parseTag(tag, { dryRun });
  if (!p.ok) return { problems: [p.reason] };
  let policy;
  try {
    policy = JSON.parse(read(POLICY_FILE));
  } catch (e) {
    problems.push(`cannot read apps/desktop/release-policy.json: ${e.message}`);
  }
  if (policy !== undefined) problems.push(...checkPolicy(policy, p.version));
  const compose = composeSha();
  let lock;
  try {
    lock = JSON.parse(read(LOCK_FILE));
  } catch (e) {
    problems.push(`cannot read apps/desktop/services.lock.json: ${e.message}`);
  }
  if (lock && lock.composeSha256 !== compose)
    problems.push(`the root compose hash ${compose} differs from the committed lock's composeSha256 ${lock.composeSha256}`);
  return { problems, version: p.version, prerelease: p.prerelease };
}

export function gate({ tag, sha, git, gh, read, composeSha, dryRun = false }) {
  const local = localChecks({ tag, dryRun, read, composeSha });
  const problems = [...local.problems];
  if (local.version === undefined) return { ok: false, problems };
  if (dryRun) return { ok: problems.length === 0, problems, version: local.version, prerelease: local.prerelease, skipped: true };
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) problems.push(`GITHUB_SHA ${JSON.stringify(sha)} is not a 40-hex commit`);
  const ref = `refs/tags/${tag}`;
  const type = git(["cat-file", "-t", ref]);
  if (type.status !== 0) problems.push(`git cat-file -t ${ref} exited ${type.status}: ${type.stderr.trim()} (was the tag object fetched?)`);
  else if (type.stdout.trim() !== "tag") problems.push(`${tag} is a ${type.stdout.trim()}, not an annotated tag`);
  const target = git(["rev-parse", `${ref}^{commit}`]);
  if (target.status !== 0) problems.push(`git rev-parse ${ref}^{commit} exited ${target.status}: ${target.stderr.trim()}`);
  else if (target.stdout.trim() !== sha) problems.push(`${tag} points at ${target.stdout.trim()}, not the workflow commit ${sha}`);
  const anc = git(["merge-base", "--is-ancestor", sha ?? "", "origin/main"]);
  if (anc.status === 1) problems.push(`${sha} is not an ancestor of origin/main`);
  else if (anc.status !== 0) problems.push(`git merge-base --is-ancestor exited ${anc.status}: ${anc.stderr.trim()}`);
  const rel = releaseState(gh(["release", "view", tag]));
  if (rel.state === "found") problems.push(`a published release for ${tag} already exists`);
  if (rel.state === "error") problems.push(`gh release view ${tag} failed: ${rel.message}`);
  return { ok: problems.length === 0, problems, version: local.version, prerelease: local.prerelease, skipped: false };
}

if (isMain(import.meta.url))
  main("gate", () => {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { tag: { type: "string" }, "dry-run": { type: "boolean" } },
    });
    const tag = values.tag ?? process.env.TAG;
    if (!tag) throw new Error("pass --tag <tag> or set TAG");
    const dryRun = values["dry-run"] === true;
    if (dryRun && process.env.OPEN_AGENT_SHELL_TEST !== "1") throw new Error("--dry-run needs OPEN_AGENT_SHELL_TEST=1");
    const r = gate({
      tag,
      sha: process.env.GITHUB_SHA,
      dryRun,
      git: spawnRunner("git", { cwd: REPO }),
      gh: spawnRunner("gh", { cwd: REPO }),
      read: (p) => readFileSync(p, "utf8"),
    });
    for (const p of r.problems) process.stderr.write(`gate: ${p}\n`);
    if (!r.ok) return 1;
    process.stdout.write(`gate: tag=${tag} version=${r.version} prerelease=${r.prerelease}\n`);
    if (r.skipped) process.stdout.write("gate: skipped: annotated tag, ancestor of main, release absent (GitHub only)\n");
    writeOutputs({ version: r.version, prerelease: String(r.prerelease), tag });
    return 0;
  });
