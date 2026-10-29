import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createJudge, type Judge } from "../src/judge/index.js";
import { judgeRank, rankTiles } from "../src/shop/rank.js";
import type { Tile } from "../src/shop/extract.js";

export type Label = "E" | "S" | "C" | "I";
export type Row = { split: "practice" | "test"; query: string; tiles: { title: string; label: Label }[] };

export const GAIN: Record<Label, number> = { E: 1, S: 0.1, C: 0.01, I: 0 };

export const FIXTURE = fileURLToPath(new URL("./fixtures/esci-grocery.jsonl", import.meta.url));

export function loadRows(path = FIXTURE, split?: Row["split"]): Row[] {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
  return split ? rows.filter((r) => r.split === split) : rows;
}

export const exactAt1 = (ranked: Label[]): number => (ranked[0] === "E" ? 1 : 0);

const dcg = (gains: number[]) => gains.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);

export function ndcgAt3(ranked: Label[], all: Label[]): number {
  const ideal = dcg(all.map((l) => GAIN[l]).sort((a, b) => b - a).slice(0, 3));
  return ideal === 0 ? 0 : dcg(ranked.slice(0, 3).map((l) => GAIN[l])) / ideal;
}

const toTile = (t: Row["tiles"][number]): Tile => ({ title: t.title, url: "", sponsored: false });

export type Ranker = (query: string, tiles: Tile[]) => Promise<Tile[] | null>;

export const keywordRanker: Ranker = async (query, tiles) => rankTiles(query, tiles);

export function jevRanker(judge: Judge, limit?: number, batch?: boolean): Ranker {
  return (query, tiles) => judgeRank(judge, query, tiles, { limit, batch });
}

export type Report = { n: number; exact1: number; ndcg3: number; fallbacks: number; ms: number };

export async function evaluate(rows: Row[], ranker: Ranker, fallback: Ranker = keywordRanker): Promise<Report> {
  let exact = 0;
  let ndcg = 0;
  let fallbacks = 0;
  const started = Date.now();
  for (const row of rows) {
    const tiles = row.tiles.map(toTile);
    const label = new Map(row.tiles.map((t) => [t.title, t.label]));
    let ranked = await ranker(row.query, tiles);
    if (!ranked) {
      fallbacks++;
      ranked = (await fallback(row.query, tiles)) ?? [];
    }
    const labels = ranked.map((t) => label.get(t.title) as Label);
    exact += exactAt1(labels);
    ndcg += ndcgAt3(labels, row.tiles.map((t) => t.label));
  }
  return { n: rows.length, exact1: exact / rows.length, ndcg3: ndcg / rows.length, fallbacks, ms: Date.now() - started };
}

async function openJudge(): Promise<Judge> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("--judge needs OPENROUTER_API_KEY in the environment");
  const runtime = await ModelRuntime.create({ authPath: join(mkdtempSync(join(tmpdir(), "rank-")), "auth.json"), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const judge = await createJudge({ runtime, model: process.env.JEV_MODEL ?? "openrouter/typesafe/jev-1.14", log: () => {} });
  if (!judge.available) throw new Error("the Jev model is not available with this key");
  return judge;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function table(lines: { name: string; split: string; r: Report; extra?: string }[]): string {
  return [
    "| ranker | split | queries | Exact@1 | NDCG@3 | fallbacks | note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...lines.map(({ name, split, r, extra }) => `| ${name} | ${split} | ${r.n} | ${pct(r.exact1)} | ${r.ndcg3.toFixed(3)} | ${r.fallbacks} | ${extra ?? ""} |`),
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const split = (args[args.indexOf("--split") + 1] === "practice" ? "practice" : "test") as Row["split"];
  const rows = loadRows(FIXTURE, split);
  const lines: Parameters<typeof table>[0] = [{ name: "keyword (rankTiles)", split, r: await evaluate(rows, keywordRanker) }];
  if (args.includes("--judge")) {
    const judge = await openJudge();
    const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : undefined;
    const r = await evaluate(rows, jevRanker(judge, limit, args.includes("--batch")));
    const u = judge.usage();
    lines.push({ name: "jev re-rank", split, r, extra: `${u.calls} calls, $${u.costUsd.toFixed(4)}, ${Math.round(r.ms / rows.length)} ms/query` });
  }
  console.log(table(lines));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
