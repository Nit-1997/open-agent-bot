import type { RunRecord, RunStats } from "./types.js";

export type ScenarioSummary = {
  runs: number;
  passes: number;
  toolCalls: number;
  llmTurns?: number | null;
  seconds: number;
  costUsd: number | null;
  inputTokens: number | null;
};

export type Summary = { model: string; label: string; date: string; scenarios: Record<string, ScenarioSummary> };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const meanOrNull = (xs: number[]) => (xs.length ? mean(xs) : null);

export function mergeStats(all: Array<RunStats | undefined>): RunStats | undefined {
  const present = all.filter((s): s is RunStats => !!s);
  if (!present.length) return undefined;
  const sum = (k: Exclude<keyof RunStats, "skills" | "llmTurns">) => present.reduce((n, s) => n + s[k], 0);
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheRead: sum("cacheRead"),
    costUsd: sum("costUsd"),
    jevCalls: sum("jevCalls"),
    jevCostUsd: sum("jevCostUsd"),
    toolCalls: sum("toolCalls"),
    ...(present.some((s) => s.llmTurns !== undefined) && { llmTurns: present.reduce((n, s) => n + (s.llmTurns ?? 0), 0) }),
    durationMs: sum("durationMs"),
    skills: [...new Set(present.flatMap((s) => s.skills))],
  };
}

export const runStats = (r: RunRecord) => mergeStats(r.turns.map((t) => t.stats));
const toolCount = (r: RunRecord) => r.turns.reduce((n, t) => n + t.tools.length, 0);
const seconds = (r: RunRecord) => r.turns.reduce((n, t) => n + t.durationMs, 0) / 1000;

export function summarize(runs: RunRecord[], meta: { model: string; label: string; date: string }): Summary {
  const byScenario = new Map<string, RunRecord[]>();
  for (const r of runs) byScenario.set(r.scenario, [...(byScenario.get(r.scenario) ?? []), r]);
  const scenarios: Record<string, ScenarioSummary> = {};
  for (const [id, rs] of byScenario) {
    const stats = rs.map(runStats).filter((s): s is RunStats => !!s);
    scenarios[id] = {
      runs: rs.length,
      passes: rs.filter((r) => r.passed).length,
      toolCalls: round(mean(rs.map(toolCount)), 1),
      llmTurns: roundOrNull(meanOrNull(stats.filter((s) => s.llmTurns !== undefined).map((s) => s.llmTurns as number)), 1),
      seconds: round(mean(rs.map(seconds)), 1),
      costUsd: roundOrNull(meanOrNull(stats.map((s) => s.costUsd)), 4),
      inputTokens: roundOrNull(meanOrNull(stats.map((s) => s.inputTokens)), 0),
    };
  }
  return { ...meta, scenarios };
}

const round = (n: number, d: number) => Number(n.toFixed(d));
const roundOrNull = (n: number | null, d: number) => (n === null ? null : round(n, d));

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");

function delta(now: number | null, before: number | null, digits: number, prefix = ""): string {
  if (now === null) return "n/a";
  const base = `${prefix}${now.toFixed(digits)}`;
  if (before === null || before === undefined) return base;
  const d = now - before;
  if (Math.abs(d) < 10 ** -digits / 2) return base;
  return `${base} (${d > 0 ? "+" : "-"}${prefix}${Math.abs(d).toFixed(digits)})`;
}

function verdict(now: ScenarioSummary, before?: ScenarioSummary): string {
  if (!before) return "new";
  const a = now.passes / now.runs;
  const b = before.passes / before.runs;
  if (a < b) return `REGRESSION ${before.passes}/${before.runs} -> ${now.passes}/${now.runs}`;
  if (a > b) return `improved ${before.passes}/${before.runs} -> ${now.passes}/${now.runs}`;
  return "same";
}

export function renderReport(runs: RunRecord[], summary: Summary, baseline?: Summary): string {
  const ids = [...new Set(runs.map((r) => r.scenario))];
  const lines = [`# Eval report: ${summary.model}`, "", `label: ${summary.label} | date: ${summary.date} | baseline: ${baseline ? `${baseline.label} (${baseline.date})` : "none"}`, ""];
  lines.push("| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const id of ids) {
    const rs = runs.filter((r) => r.scenario === id);
    const s = summary.scenarios[id];
    const b = baseline?.scenarios[id];
    const perRun = rs.map((r) => (r.passed ? "pass" : "FAIL")).join(" ");
    const failures = new Map<string, number>();
    for (const r of rs) {
      if (r.error) failures.set(`error: ${r.error}`, (failures.get(`error: ${r.error}`) ?? 0) + 1);
      for (const f of r.failed) failures.set(f.label, (failures.get(f.label) ?? 0) + 1);
    }
    const failed = [...failures].map(([l, n]) => (rs.length > 1 ? `${l} x${n}` : l)).join("; ") || "-";
    lines.push(
      `| ${id} | ${perRun} | ${cell(failed)} | ${delta(s.toolCalls, b?.toolCalls ?? null, 1)} | ${delta(s.llmTurns ?? null, b?.llmTurns ?? null, 1)} | ${delta(s.seconds, b?.seconds ?? null, 1)} | ${delta(s.costUsd, b?.costUsd ?? null, 4, "$")} | ${delta(s.inputTokens, b?.inputTokens ?? null, 0)} | ${verdict(s, b)} |`,
    );
  }
  const total = ids.reduce((n, id) => n + summary.scenarios[id].passes, 0);
  const all = ids.reduce((n, id) => n + summary.scenarios[id].runs, 0);
  lines.push("", `Passed ${total} of ${all} runs.`);

  const details = runs.filter((r) => !r.passed);
  if (details.length) {
    lines.push("", "## Failures", "");
    for (const r of details) {
      lines.push(`- ${r.scenario} run ${r.run + 1}${r.error ? `: ${r.error}` : ""}`);
      for (const f of r.failed) lines.push(`  - ${f.label}: ${f.detail}`);
    }
  }
  const future = runs.filter((r) => r.future.length);
  if (future.length) {
    lines.push("", "## Future assertions (not counted)", "");
    for (const r of future) {
      lines.push(`- ${r.scenario} run ${r.run + 1}`);
      for (const f of r.future) lines.push(`  - ${f.ok ? "would pass" : "would fail"}: ${f.label} (${f.detail})`);
    }
  }
  return `${lines.join("\n")}\n`;
}
