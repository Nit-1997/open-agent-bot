import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { evaluateAll } from "./assert.js";
import { mergeStats, renderReport, type Summary, summarize } from "./report.js";
import { type AguiEvent, readEvents } from "./sse.js";
import type { Assertion, RunRecord, RunStats, Scenario, ToolRecord, TurnRecord, WidgetRecord } from "./types.js";

const evalsDir = dirname(fileURLToPath(import.meta.url));
const RESULT_CLIP = 4000;

type Message = { id: string; role: "user" | "assistant"; content: string };

export function createTurnCollector() {
  const tools: ToolRecord[] = [];
  const widgets: WidgetRecord[] = [];
  const stats: RunStats[] = [];
  const texts: string[] = [];
  const open = new Map<string, { index: number; widget: boolean; args: string }>();
  let unverifiedClaims = 0;
  let legText = "";
  let error: string | undefined;
  let finished = false;
  let currentText: string | undefined;

  const closeText = () => {
    if (currentText?.trim()) {
      texts.push(currentText);
      legText += `${legText ? "\n\n" : ""}${currentText}`;
    }
    currentText = undefined;
  };

  const finishCall = (id: string) => {
    const call = open.get(id);
    if (!call?.widget) return;
    try {
      const widget = (JSON.parse(call.args) as { widget?: { kind?: string; claims?: unknown[] } }).widget;
      if (!widget?.kind) return;
      widgets.push({ kind: widget.kind, json: JSON.stringify(widget) });
      if (widget.kind === "grounding_note" && Array.isArray(widget.claims)) unverifiedClaims += widget.claims.length;
    } catch {}
  };

  return {
    beginLeg() {
      legText = "";
      error = undefined;
      finished = false;
    },
    add(e: AguiEvent) {
      switch (e.type) {
        case "TOOL_CALL_START": {
          const id = String(e.toolCallId);
          const name = String(e.toolCallName);
          const widget = name === "show_widget";
          open.set(id, { index: widget ? -1 : tools.push({ name, args: {}, result: "" }) - 1, widget, args: "" });
          break;
        }
        case "TOOL_CALL_ARGS": {
          const call = open.get(String(e.toolCallId));
          if (call) call.args += String(e.delta ?? "");
          break;
        }
        case "TOOL_CALL_END": {
          const id = String(e.toolCallId);
          const call = open.get(id);
          if (!call) break;
          if (call.widget) finishCall(id);
          else {
            try {
              tools[call.index].args = JSON.parse(call.args || "{}");
            } catch {
              tools[call.index].args = call.args;
            }
          }
          break;
        }
        case "TOOL_CALL_RESULT": {
          const call = open.get(String(e.toolCallId));
          if (call && !call.widget) tools[call.index].result = String(e.content ?? "").slice(0, RESULT_CLIP);
          break;
        }
        case "TEXT_MESSAGE_START":
          closeText();
          currentText = "";
          break;
        case "TEXT_MESSAGE_CONTENT":
          currentText = (currentText ?? "") + String(e.delta ?? "");
          break;
        case "TEXT_MESSAGE_END":
          closeText();
          break;
        case "CUSTOM":
          if (e.name === "run_stats" && e.value && typeof e.value === "object") stats.push(e.value as RunStats);
          break;
        case "RUN_ERROR":
          error = String(e.message ?? "run error");
          break;
        case "RUN_FINISHED":
          finished = true;
          break;
      }
    },
    leg() {
      closeText();
      return { text: legText, error, finished };
    },
    turn(prompt: string, durationMs: number, turnError?: string): TurnRecord {
      closeText();
      const merged = mergeStats(stats);
      return {
        prompt,
        tools,
        widgets,
        unverifiedClaims,
        text: texts.join("\n\n"),
        askedUser: tools.some((t) => t.name === "ask_user"),
        durationMs,
        ...(merged && { stats: merged }),
        ...(turnError && { error: turnError }),
      };
    },
    askedUser: () => tools.some((t) => t.name === "ask_user"),
  };
}

export function localTime(timeZone: string, now: Date = new Date()): string {
  return now.toLocaleString("sv-SE", { timeZone }).replace(" ", "T");
}

export function buildInput(opts: { threadId: string; messages: Message[]; scenario: Scenario; model: string; now?: Date }) {
  const { scenario, model } = opts;
  const userContext = {
    timeZone: scenario.context.timeZone,
    locale: scenario.context.locale,
    localTime: localTime(scenario.context.timeZone, opts.now),
    model,
    profile: { home: scenario.context.home },
  };
  return {
    threadId: opts.threadId,
    runId: randomUUID(),
    messages: opts.messages,
    tools: [],
    context: [{ description: "user_context", value: JSON.stringify(userContext) }],
    state: {},
    forwardedProps: {},
  };
}

export type RunnerDeps = { url: string; secret: string | undefined; model: string; timeoutMs: number; fetch?: typeof fetch };

export async function runScenario(scenario: Scenario, runIndex: number, deps: RunnerDeps): Promise<RunRecord> {
  const doFetch = deps.fetch ?? fetch;
  const threadId = randomUUID();
  const messages: Message[] = [];
  const turns: TurnRecord[] = [];
  let failure: string | undefined;

  for (const [i, turn] of scenario.turns.entries()) {
    const collector = createTurnCollector();
    const started = Date.now();
    const deadline = started + deps.timeoutMs;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deps.timeoutMs);
    let turnError: string | undefined;
    let next: string | undefined = turn.prompt;
    let asked = false;
    try {
      while (next !== undefined) {
        messages.push({ id: randomUUID(), role: "user", content: next });
        next = undefined;
        collector.beginLeg();
        const res = await doFetch(deps.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            ...(deps.secret && { "x-agent-secret": deps.secret }),
          },
          body: JSON.stringify(buildInput({ threadId, messages, scenario, model: deps.model })),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
        for await (const e of readEvents(res.body)) collector.add(e);
        const leg = collector.leg();
        if (leg.error) throw new Error(`run error: ${leg.error}`);
        if (!leg.finished) throw new Error("stream ended without RUN_FINISHED");
        if (leg.text) messages.push({ id: randomUUID(), role: "assistant", content: leg.text });
        if (!asked && turn.if_asked && collector.askedUser()) {
          asked = true;
          next = turn.if_asked;
        }
      }
    } catch (err) {
      const aborted = ac.signal.aborted || Date.now() >= deadline;
      turnError = aborted ? `turn ${i + 1} timed out after ${Math.round(deps.timeoutMs / 1000)}s` : err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    turns.push(collector.turn(turn.prompt, Date.now() - started, turnError));
    if (turnError) {
      failure = turnError;
      break;
    }
  }

  const results = evaluateAll(scenario.assert, turns);
  const failed = results.filter((r) => !r.ok);
  return {
    scenario: scenario.id,
    model: deps.model,
    run: runIndex,
    threadId,
    turns,
    ...(failure && { error: failure }),
    passed: !failure && failed.length === 0,
    failed,
    future: evaluateAll(scenario.future_assert, turns),
  };
}

export function rescore(record: RunRecord, scenario: Scenario, price?: { input: number; output: number; cacheRead: number }): RunRecord {
  const turns = price
    ? record.turns.map((t) =>
        t.stats && !t.stats.costUsd
          ? { ...t, stats: { ...t.stats, costUsd: (t.stats.inputTokens * price.input + t.stats.outputTokens * price.output + t.stats.cacheRead * price.cacheRead) / 1e6 } }
          : t,
      )
    : record.turns;
  const failed = evaluateAll(scenario.assert, turns).filter((r) => !r.ok);
  return { ...record, turns, passed: !record.error && failed.length === 0, failed, future: evaluateAll(scenario.future_assert, turns) };
}

export function parseScenario(raw: unknown, file: string): Scenario {
  const v = raw as Partial<Scenario> | null;
  if (!v || typeof v.id !== "string" || !v.context || !Array.isArray(v.turns) || !v.turns.length) throw new Error(`${file}: scenario needs id, context and turns`);
  const list = (x: unknown): Assertion[] => (Array.isArray(x) ? (x as Assertion[]) : []);
  return { id: v.id, proves: v.proves ?? [], context: v.context, turns: v.turns, assert: list(v.assert), future_assert: list((v as Record<string, unknown>).future_assert) };
}

export function loadScenarios(dir: string, only?: string[]): Scenario[] {
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => parseScenario(parseYaml(readFileSync(join(dir, f), "utf8")), f));
  if (!only) return all;
  const missing = only.filter((id) => !all.some((s) => s.id === id));
  if (missing.length) throw new Error(`unknown scenario(s): ${missing.join(", ")}`);
  return all.filter((s) => only.includes(s.id));
}

export function readSecret(envFile: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.AGENT_SHARED_SECRET) return env.AGENT_SHARED_SECRET;
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("AGENT_SHARED_SECRET="));
  return line?.slice("AGENT_SHARED_SECRET=".length).trim().replace(/^["']|["']$/g, "") || undefined;
}

export async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string", default: "chat-default" },
      only: { type: "string" },
      runs: { type: "string", default: "1" },
      label: { type: "string", default: "adhoc" },
      url: { type: "string", default: "http://localhost:8000/agui" },
      concurrency: { type: "string", default: "1" },
      "timeout-s": { type: "string", default: "420" },
      "env-file": { type: "string", default: resolve(evalsDir, "../../deploy-config/.env-agent") },
      "write-baseline": { type: "boolean", default: false },
      rescore: { type: "string" },
      price: { type: "string" },
    },
  });
  if (values.rescore) return rescoreDir(values.rescore, values.price, values["write-baseline"] === true);
  const model = values.model as string;
  const label = values.label as string;
  const runs = Number(values.runs);
  const scenarios = loadScenarios(join(evalsDir, "scenarios"), values.only?.split(",").map((s) => s.trim()).filter(Boolean));
  const secret = readSecret(values["env-file"] as string);
  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(evalsDir, "results", `${date}-${label}-${model}`);
  await mkdir(outDir, { recursive: true });
  const jsonl = join(outDir, "runs.jsonl");
  await writeFile(jsonl, "");

  const deps: RunnerDeps = { url: values.url as string, secret, model, timeoutMs: Number(values["timeout-s"]) * 1000 };
  const jobs = scenarios.flatMap((s) => Array.from({ length: runs }, (_, i) => ({ s, i })));
  const records: RunRecord[] = [];
  await pool(jobs, Number(values.concurrency), async ({ s, i }) => {
    const record = await runScenario(s, i, deps);
    records.push(record);
    await appendFile(jsonl, `${JSON.stringify(record)}\n`);
    console.log(`${record.passed ? "pass" : "FAIL"} ${s.id} run ${i + 1}${record.error ? ` (${record.error})` : ""}`);
  });
  records.sort((a, b) => scenarios.findIndex((s) => s.id === a.scenario) - scenarios.findIndex((s) => s.id === b.scenario) || a.run - b.run);

  const summary = summarize(records, { model, label, date });
  const baselinePath = join(evalsDir, "baseline", `${model}.json`);
  const baseline = existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Summary) : undefined;
  const report = renderReport(records, summary, baseline);
  await writeFile(join(outDir, "report.md"), report);
  console.log(`\n${report}`);
  console.log(`wrote ${outDir}`);
  if (values["write-baseline"]) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`wrote baseline ${baselinePath}`);
  }
}

async function rescoreDir(dir: string, priceArg: string | undefined, writeBaseline: boolean) {
  const [input, output, cacheRead] = (priceArg ?? "").split(",").map(Number);
  const price = priceArg ? { input, output, cacheRead: cacheRead || 0 } : undefined;
  const scenarios = loadScenarios(join(evalsDir, "scenarios"));
  const records = readFileSync(join(dir, "runs.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRecord)
    .map((r) => {
      const s = scenarios.find((x) => x.id === r.scenario);
      return s ? rescore(r, s, price) : r;
    })
    .sort((a, b) => a.scenario.localeCompare(b.scenario) || a.run - b.run);
  await writeFile(join(dir, "runs.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const model = records[0].model;
  const name = basename(dir);
  const date = name.slice(0, 10);
  const label = name.slice(11, name.endsWith(`-${model}`) ? -model.length - 1 : undefined) || "rescored";
  const summary = summarize(records, { model, label, date });
  const baselinePath = join(evalsDir, "baseline", `${model}.json`);
  const baseline = !writeBaseline && existsSync(baselinePath) ? (JSON.parse(readFileSync(baselinePath, "utf8")) as Summary) : undefined;
  const report = renderReport(records, summary, baseline);
  await writeFile(join(dir, "report.md"), report);
  console.log(report);
  if (writeBaseline) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`wrote baseline ${baselinePath}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
