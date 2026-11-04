import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO } from "./cli.mjs";

export const WORKFLOW_FILE = join(REPO, ".github/workflows/release.yml");
export const GITHUB_BASH = Object.freeze(["--noprofile", "--norc", "-eo", "pipefail", "-c"]);
const DOWNLOAD = "actions/download-artifact@";
const JOB_KEYS = new Set(["needs", "runs-on", "timeout-minutes", "permissions", "environment", "steps"]);
const RUN_KEYS = new Set(["name", "id", "env", "working-directory", "run"]);
const USES_KEYS = new Set(["name", "id", "uses", "with"]);
const DOWNLOAD_WITH = new Set(["name", "path"]);

function refuseKeys(where, keys, allowed, prefix = "") {
  const extra = keys.filter((k) => !allowed.has(k)).map((k) => prefix + k);
  if (extra.length) throw new Error(`${where} has ${extra.join(", ")}, which the dry run does not execute`);
}

export const loadWorkflow = (text = readFileSync(WORKFLOW_FILE, "utf8")) => parse(text);

export function resolveExpr(value, ctx) {
  return String(value).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    if (expr === "runner.temp") return ctx.temp;
    if (expr === "needs.gate.outputs.version") return ctx.version;
    throw new Error(`release.yml expression \${{ ${expr} }} has no dry-run value`);
  });
}

export function planJob(wf, job, ctx) {
  if (wf?.defaults?.run?.shell !== "bash") throw new Error("release.yml must run steps with defaults.run.shell: bash");
  const steps = wf.jobs?.[job]?.steps;
  if (!Array.isArray(steps)) throw new Error(`release.yml has no ${job} job`);
  refuseKeys(job, Object.keys(wf.jobs[job]), JOB_KEYS, "job-level ");
  const downloads = [];
  const runs = [];
  const skipped = [];
  for (const s of steps) {
    const uses = String(s.uses ?? "");
    const label = `${job} step "${s.name ?? (uses || "run")}"`;
    if (typeof s.run === "string") {
      if (s.shell !== undefined) throw new Error(`${label} overrides the shell`);
      refuseKeys(label, Object.keys(s), RUN_KEYS);
      if (s.run.includes("${{")) throw new Error(`${label} has \${{ in its run text, which the dry run does not resolve`);
    } else refuseKeys(label, Object.keys(s), USES_KEYS);
    if (uses.startsWith(DOWNLOAD)) {
      refuseKeys(label, Object.keys(s.with ?? {}), DOWNLOAD_WITH, "with.");
      const from = ctx.artifacts[s.with?.name];
      if (!from) throw new Error(`${job} downloads ${s.with?.name ?? s.with?.pattern}, which the dry run does not produce`);
      downloads.push({ name: s.with.name, from, to: resolveExpr(s.with.path, ctx) });
    } else if (typeof s.run === "string") {
      const env = Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, resolveExpr(v, ctx)]));
      const cwd = s["working-directory"] === undefined ? join(ctx.temp, "workspace") : resolveExpr(s["working-directory"], ctx);
      runs.push({ name: s.name, run: s.run, env, cwd });
    } else if ((ctx.skip ?? []).some((p) => uses.startsWith(p))) skipped.push(uses.slice(0, uses.indexOf("@")));
    else throw new Error(`${label} has no dry-run equivalent`);
  }
  if (runs.length !== 1) throw new Error(`${job} must have exactly one run step, has ${runs.length}`);
  return { job, downloads, run: runs[0], skipped };
}

function mirror(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const dest = join(to, e.name);
    try {
      linkSync(join(from, e.name), dest);
    } catch {
      copyFileSync(join(from, e.name), dest);
    }
  }
}

export function runPlanned(plan, ctx, step) {
  for (const d of plan.downloads) mirror(d.from, d.to);
  mkdirSync(plan.run.cwd, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: ctx.temp, ...plan.run.env };
  return step(`${plan.job}/run`, "bash", [...GITHUB_BASH, plan.run.run], { env, cwd: plan.run.cwd, allowFail: true });
}

export function detachLeftovers(temp, exec = spawnSync) {
  if (!existsSync(temp)) return [];
  const dev = statSync(temp).dev;
  const left = readdirSync(temp)
    .map((n) => join(temp, n))
    .filter((p) => statSync(p).isDirectory() && statSync(p).dev !== dev);
  for (const p of left) exec("hdiutil", ["detach", "-force", p], { encoding: "utf8" });
  return left;
}
