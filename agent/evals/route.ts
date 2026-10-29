import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AREA_THRESHOLD, POLICY_THRESHOLD, type Route, route } from "../src/agui/router.js";
import { AREAS, type Area, type Intent } from "../src/judge/criteria/routeAreas.js";
import { createJudge, type Judge } from "../src/judge/index.js";

export type RouteRow = {
  split: "practice" | "test";
  prompt: string;
  lastTurns?: { role: "user" | "assistant"; text: string }[];
  workspace?: string;
  areas: Area[];
  intent: Intent;
  missing?: boolean;
};

export type Scored = { row: RouteRow; route: Route | null; ms: number };

export const FIXTURE = fileURLToPath(new URL("./fixtures/routing.jsonl", import.meta.url));

export function loadRows(path = FIXTURE, split?: RouteRow["split"]): RouteRow[] {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RouteRow);
  return split ? rows.filter((r) => r.split === split) : rows;
}

export type Summary = {
  n: number;
  failures: number;
  perArea: Record<Area, { recall: number | null; precision: number | null }>;
  allFlagged: number;
  intentAccuracy: number;
  handoffRecall: number;
  falseHandoffs: number;
  missingAccuracy: number;
  p50: number;
  p95: number;
};

const ratio = (num: number, den: number) => (den ? num / den : null);

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}

export function summarize(scored: Scored[], threshold = AREA_THRESHOLD): Summary {
  const answered = scored.filter((s) => s.route);
  const flagged = (s: Scored): Area[] => AREAS.filter((a) => (s.route?.areas[a] ?? 0) >= threshold);
  const perArea = Object.fromEntries(
    AREAS.map((a) => {
      const expected = answered.filter((s) => s.row.areas.includes(a));
      const hit = expected.filter((s) => flagged(s).includes(a));
      const predicted = answered.filter((s) => flagged(s).includes(a));
      return [a, { recall: ratio(hit.length, expected.length), precision: ratio(predicted.filter((s) => s.row.areas.includes(a)).length, predicted.length) }];
    }),
  ) as Summary["perArea"];
  const handoffs = (s: Scored) => !!s.route && s.route.intent !== "plan" && s.route.intentP >= POLICY_THRESHOLD;
  const wantHandoff = scored.filter((s) => s.row.intent !== "plan");
  const labeledMissing = answered.filter((s) => s.row.missing !== undefined);
  return {
    n: scored.length,
    failures: scored.length - answered.length,
    perArea,
    allFlagged: scored.filter((s) => s.row.areas.every((a) => s.route && flagged(s).includes(a))).length / scored.length,
    intentAccuracy: answered.filter((s) => s.route?.intent === s.row.intent).length / scored.length,
    handoffRecall: wantHandoff.filter((s) => handoffs(s) && s.route?.intent === s.row.intent).length / Math.max(wantHandoff.length, 1),
    falseHandoffs: scored.filter((s) => s.row.intent === "plan" && handoffs(s)).length,
    missingAccuracy: labeledMissing.filter((s) => (s.route!.missingDetails >= 0.5) === s.row.missing).length / Math.max(labeledMissing.length, 1),
    p50: percentile(scored.map((s) => s.ms), 0.5),
    p95: percentile(scored.map((s) => s.ms), 0.95),
  };
}

const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);

export function table(rows: { split: string; s: Summary }[]): string {
  return [
    "| split | prompts | every expected area flagged | intent acc | hand-off recall | false hand-offs | missing-details acc | failures | p50 ms | p95 ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(({ split, s }) => `| ${split} | ${s.n} | ${pct(s.allFlagged)} | ${pct(s.intentAccuracy)} | ${pct(s.handoffRecall)} | ${s.falseHandoffs} | ${pct(s.missingAccuracy)} | ${s.failures} | ${s.p50} | ${s.p95} |`),
  ].join("\n");
}

export function areaTable(rows: { split: string; s: Summary }[]): string {
  return [
    `| split | ${AREAS.map((a) => `${a} R/P`).join(" | ")} |`,
    `| --- | ${AREAS.map(() => "---").join(" | ")} |`,
    ...rows.map(({ split, s }) => `| ${split} | ${AREAS.map((a) => `${pct(s.perArea[a].recall)} / ${pct(s.perArea[a].precision)}`).join(" | ")} |`),
  ].join("\n");
}

async function openJudge(): Promise<Judge> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("route eval needs OPENROUTER_API_KEY in the environment");
  const runtime = await ModelRuntime.create({ authPath: join(mkdtempSync(join(tmpdir(), "route-")), "auth.json"), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const judge = await createJudge({ runtime, model: process.env.JEV_MODEL ?? "openrouter/typesafe/jev-1.14", log: () => {} });
  if (!judge.available) throw new Error("the Jev model is not available with this key");
  return judge;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const threshold = flag("--threshold") ? Number(flag("--threshold")) : AREA_THRESHOLD;
  const rows = loadRows();
  let scored: Scored[];
  const cached = flag("--from");
  if (cached) {
    scored = (JSON.parse(readFileSync(cached, "utf8")) as Scored[]).map((s) => ({ ...s, row: rows.find((r) => r.prompt === s.row.prompt) ?? s.row }));
  } else {
    const judge = await openJudge();
    scored = [];
    for (let i = 0; i < rows.length; i += 4) {
      scored.push(
        ...(await Promise.all(
          rows.slice(i, i + 4).map(async (row) => {
            const started = Date.now();
            const r = await route(judge, { message: row.prompt, lastTurns: row.lastTurns ?? [], workspaceSummary: row.workspace });
            return { row, route: r, ms: Date.now() - started };
          }),
        )),
      );
    }
    const u = judge.usage();
    console.log(`jev calls=${u.calls} failures=${u.failures} cost=$${u.costUsd.toFixed(4)}`);
    if (flag("--dump")) writeFileSync(flag("--dump")!, JSON.stringify(scored));
  }
  const parts = (["practice", "test"] as const).map((split) => ({ split, s: summarize(scored.filter((s) => s.row.split === split), threshold) }));
  const all = { split: "all", s: summarize(scored, threshold) };
  console.log(`threshold=${threshold}`);
  console.log(table([...parts, all]));
  console.log(areaTable([...parts, all]));
  if (args.includes("--misses")) {
    for (const s of scored) {
      const got = AREAS.filter((a) => (s.route?.areas[a] ?? 0) >= threshold);
      const missed = s.row.areas.filter((a) => !got.includes(a));
      const extra = got.filter((a) => !s.row.areas.includes(a));
      if (missed.length || extra.length || s.route?.intent !== s.row.intent) {
        console.log(`[${s.row.split}] ${JSON.stringify(s.row.prompt)} missed=${missed} extra=${extra} intent=${s.route?.intent}:${s.route?.intentP.toFixed(2)} want=${s.row.intent}`);
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
