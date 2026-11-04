import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO } from "./cli.mjs";

export const WORKFLOW_FILE = join(REPO, ".github/workflows/release.yml");
export const GITHUB_BASH = Object.freeze(["--noprofile", "--norc", "-eo", "pipefail", "-c"]);
const DOWNLOAD = "actions/download-artifact@";

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
  const downloads = [];
  const runs = [];
  const skipped = [];
  for (const s of steps) {
    const uses = String(s.uses ?? "");
    if (uses.startsWith(DOWNLOAD)) {
      const from = ctx.artifacts[s.with?.name];
      if (!from) throw new Error(`${job} downloads ${s.with?.name ?? s.with?.pattern}, which the dry run does not produce`);
      downloads.push({ name: s.with.name, from, to: resolveExpr(s.with.path, ctx) });
    } else if (typeof s.run === "string") {
      if (s.shell !== undefined) throw new Error(`${job} step "${s.name}" overrides the shell`);
      const env = Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, resolveExpr(v, ctx)]));
      const cwd = s["working-directory"] === undefined ? join(ctx.temp, "workspace") : resolveExpr(s["working-directory"], ctx);
      runs.push({ name: s.name, run: s.run, env, cwd });
    } else if ((ctx.skip ?? []).some((p) => uses.startsWith(p))) skipped.push(uses.slice(0, uses.indexOf("@")));
    else throw new Error(`${job} step "${s.name ?? uses}" has no dry-run equivalent`);
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
