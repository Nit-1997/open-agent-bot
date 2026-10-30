import { describe, expect, it } from "vitest";
import { evaluateAll } from "../../evals/assert.js";
import { renderReport, summarize } from "../../evals/report.js";
import { buildInput, createTurnCollector, loadScenarios, pool, readSecret, rescore, runScenario } from "../../evals/run.js";
import type { RunRecord, Scenario } from "../../evals/types.js";

const ev = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

const stats = { inputTokens: 100, outputTokens: 10, cacheRead: 0, costUsd: 0.5, jevCalls: 0, jevCostUsd: 0, toolCalls: 1, durationMs: 10, skills: [] };

const answer = (text: string, extra: object[] = []) =>
  [
    { type: "RUN_STARTED" },
    ...extra,
    { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: text },
    { type: "TEXT_MESSAGE_END", messageId: "m" },
    { type: "CUSTOM", name: "run_stats", value: stats },
    { type: "RUN_FINISHED" },
  ]
    .map(ev)
    .join("");

const call = (id: string, name: string, args: object, result: string) => [
  { type: "TOOL_CALL_START", toolCallId: id, toolCallName: name },
  { type: "TOOL_CALL_ARGS", toolCallId: id, delta: JSON.stringify(args) },
  { type: "TOOL_CALL_END", toolCallId: id },
  { type: "TOOL_CALL_RESULT", toolCallId: id, content: result, role: "tool" },
];

const respond = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  id: "s",
  proves: [],
  context: { timeZone: "America/Los_Angeles", locale: "en-US", home: "Palo Alto, CA" },
  turns: [{ prompt: "hello" }],
  assert: [],
  future_assert: [],
  ...over,
});

const deps = (fetchImpl: typeof fetch, timeoutMs = 5000) => ({ url: "http://x/agui", secret: "sek", model: "m1", timeoutMs, fetch: fetchImpl });

describe("createTurnCollector", () => {
  it("records tools with parsed args and clipped results, widgets, claims, text and stats", () => {
    const c = createTurnCollector();
    const events = [
      ...call("t1", "stays", { city: "Paris" }, "x".repeat(5000)),
      ...call("w1", "show_widget", { widget: { kind: "grounding_note", claims: ["a", "b"] } }, "rendered grounding_note"),
      { type: "TEXT_MESSAGE_START", messageId: "m" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "hi " },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "there" },
      { type: "TEXT_MESSAGE_END", messageId: "m" },
      { type: "CUSTOM", name: "browser_frame", value: {} },
      { type: "CUSTOM", name: "run_stats", value: stats },
      { type: "RUN_FINISHED" },
    ];
    c.beginLeg();
    for (const e of events) c.add(e);
    const turn = c.turn("p", 1234);
    expect(turn.tools).toHaveLength(1);
    expect(turn.tools[0]).toMatchObject({ name: "stays", args: { city: "Paris" } });
    expect(turn.tools[0].result).toHaveLength(4000);
    expect(turn.widgets).toEqual([{ kind: "grounding_note", json: JSON.stringify({ kind: "grounding_note", claims: ["a", "b"] }) }]);
    expect(turn.unverifiedClaims).toBe(2);
    expect(turn.text).toBe("hi there");
    expect(turn.stats?.costUsd).toBe(0.5);
    expect(c.leg()).toMatchObject({ finished: true, text: "hi there" });
  });
});

describe("runScenario", () => {
  it("posts the conversation with auth, user context and a fresh thread, and passes when assertions hold", async () => {
    const bodies: any[] = [];
    const headers: Array<Record<string, string>> = [];
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      headers.push(init.headers as Record<string, string>);
      return respond(answer("Found it", call("t1", "shop", { items: [{ query: "pizza", qty: 16 }] }, "ok")));
    }) as unknown as typeof fetch;
    const sc = scenario({ turns: [{ prompt: "one" }, { prompt: "two" }], assert: [{ type: "must_call", tool: "shop", turn: 2 }] });
    const r = await runScenario(sc, 0, deps(f));
    expect(r.passed).toBe(true);
    expect(headers[0]).toMatchObject({ "x-agent-secret": "sek", accept: "text/event-stream" });
    expect(bodies[1].threadId).toBe(bodies[0].threadId);
    expect(bodies[1].messages.map((m: any) => [m.role, m.content])).toEqual([
      ["user", "one"],
      ["assistant", "Found it"],
      ["user", "two"],
    ]);
    const ctx = JSON.parse(bodies[0].context[0].value);
    expect(bodies[0].context[0].description).toBe("user_context");
    expect(ctx).toMatchObject({ timeZone: "America/Los_Angeles", locale: "en-US", model: "m1", profile: { home: "Palo Alto, CA" } });
    expect(ctx.localTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(r.turns[0].stats?.inputTokens).toBe(100);
  });

  it("sends if_asked within the same turn after ask_user", async () => {
    const sent: string[] = [];
    let n = 0;
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push(body.messages.at(-1).content);
      return respond(n++ === 0 ? answer("What date?", call("a", "ask_user", {}, "")) : answer("Done", call("s", "shop", {}, "")));
    }) as unknown as typeof fetch;
    const sc = scenario({ turns: [{ prompt: "plan", if_asked: "Saturday" }], assert: [{ type: "must_call", tool: "shop", turn: 1 }] });
    const r = await runScenario(sc, 0, deps(f));
    expect(sent).toEqual(["plan", "Saturday"]);
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].askedUser).toBe(true);
    expect(r.passed).toBe(true);
  });

  it("counts future assertions without letting them fail the run", async () => {
    const f = (async () => respond(answer("hi"))) as unknown as typeof fetch;
    const r = await runScenario(scenario({ future_assert: [{ type: "must_call", tool: "load_skill" }] }), 0, deps(f));
    expect(r.passed).toBe(true);
    expect(r.future).toMatchObject([{ ok: false }]);
  });

  it("fails the scenario with the reason on a RUN_ERROR and stops later turns", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return respond([{ type: "RUN_STARTED" }, { type: "RUN_ERROR", message: "boom" }].map(ev).join(""));
    }) as unknown as typeof fetch;
    const r = await runScenario(scenario({ turns: [{ prompt: "a" }, { prompt: "b" }] }), 0, deps(f));
    expect(calls).toBe(1);
    expect(r.passed).toBe(false);
    expect(r.error).toContain("boom");
  });

  it("aborts a turn that exceeds the hard timeout and says so", async () => {
    const f = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const r = await runScenario(scenario(), 0, deps(f, 30));
    expect(r.passed).toBe(false);
    expect(r.error).toMatch(/turn 1 timed out/);
  });

  it("reports HTTP failures", async () => {
    const f = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const r = await runScenario(scenario(), 0, deps(f));
    expect(r.error).toContain("HTTP 401");
  });
});

describe("helpers", () => {
  it("loads every committed scenario and each assertion evaluates without a config error", () => {
    const ids = loadScenarios(new URL("../../evals/scenarios", import.meta.url).pathname).map((s) => s.id);
    expect(ids.sort()).toEqual(["car", "cities-fanout", "dining", "events", "gifts", "grocery-offlist", "hotel-brand", "india-shop", "party", "party-followup", "playlist", "recipe-cart", "research", "store-domain", "trip"]);
    for (const s of loadScenarios(new URL("../../evals/scenarios", import.meta.url).pathname)) {
      const empty = [{ prompt: "", tools: [], widgets: [], unverifiedClaims: 0, text: "", askedUser: false, durationMs: 0 }];
      for (const r of evaluateAll([...s.assert, ...s.future_assert], [...empty, ...empty])) expect(r.detail, `${s.id} ${r.label}`).not.toMatch(/needs|unknown assertion|Invalid regular/);
      expect(s.turns.length).toBeGreaterThan(0);
    }
  });

  it("selects the long-tail set and rejects unknown sets", () => {
    const dir = new URL("../../evals/scenarios", import.meta.url).pathname;
    expect(loadScenarios(dir, undefined, "long-tail").map((s) => s.id)).toEqual(["dining", "events", "gifts"]);
    expect(() => loadScenarios(dir, undefined, "nope")).toThrow(/nope/);
  });

  it("rejects unknown --only ids", () => {
    expect(() => loadScenarios(new URL("../../evals/scenarios", import.meta.url).pathname, ["nope"])).toThrow(/nope/);
  });

  it("reads the secret from the environment first, then the env file", () => {
    expect(readSecret("/nonexistent", { AGENT_SHARED_SECRET: "env" })).toBe("env");
    expect(readSecret("/nonexistent", {})).toBeUndefined();
  });

  it("builds RunAgentInput with a unique run id", () => {
    const a = buildInput({ threadId: "t", messages: [], scenario: scenario(), model: "m" });
    const b = buildInput({ threadId: "t", messages: [], scenario: scenario(), model: "m" });
    expect(a.runId).not.toBe(b.runId);
  });

  it("limits concurrency", async () => {
    let active = 0;
    let peak = 0;
    await pool([1, 2, 3, 4, 5], 2, async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBe(2);
  });
});

describe("report", () => {
  const rec = (scenarioId: string, run: number, passed: boolean, failedLabel = "must_call(tool=shop)"): RunRecord => ({
    scenario: scenarioId,
    model: "m1",
    run,
    threadId: "t",
    turns: [{ prompt: "p", tools: [{ name: "shop", args: {}, result: "" }], widgets: [], unverifiedClaims: 0, text: "", askedUser: false, durationMs: 12000, stats }],
    passed,
    failed: passed ? [] : [{ label: failedLabel, ok: false, detail: "shop called 0x" }],
    future: [{ label: "must_call(tool=load_skill)", ok: false, detail: "load_skill called 0x" }],
  });

  it("summarizes averages and renders a table with failures, future assertions and a baseline diff", () => {
    const runs = [rec("party", 0, true), rec("party", 1, false), rec("car", 0, true)];
    const summary = summarize(runs, { model: "m1", label: "x", date: "2026-10-29" });
    expect(summary.scenarios.party).toMatchObject({ runs: 2, passes: 1, toolCalls: 1, seconds: 12, costUsd: 0.5, inputTokens: 100 });
    const baseline = { ...summary, label: "base", scenarios: { party: { ...summary.scenarios.party, passes: 2 }, car: { ...summary.scenarios.car, costUsd: 0.25 } } };
    const md = renderReport(runs, summary, baseline);
    expect(md).toContain("| party | pass FAIL |");
    expect(md).toContain("must_call(tool=shop) x1");
    expect(md).toContain("REGRESSION 2/2 -> 1/2");
    expect(md).toContain("$0.5000 (+$0.2500)");
    expect(md).toContain("Passed 2 of 3 runs.");
    expect(md).toContain("Future assertions (not counted)");
  });

  it("tolerates runs without stats", () => {
    const r = rec("car", 0, true);
    r.turns[0].stats = undefined;
    const summary = summarize([r], { model: "m1", label: "x", date: "d" });
    expect(summary.scenarios.car.costUsd).toBeNull();
    expect(renderReport([r], summary)).toContain("n/a");
  });
});

describe("rescore", () => {
  it("re-grades a saved run with the current assertions and fills missing cost from a price", () => {
    const record: RunRecord = {
      scenario: "s",
      model: "m",
      run: 0,
      threadId: "t",
      turns: [{ prompt: "p", tools: [{ name: "shop", args: {}, result: "ok" }], widgets: [], unverifiedClaims: 0, text: "hi", askedUser: false, durationMs: 1, stats: { ...stats, costUsd: 0, inputTokens: 1_000_000, outputTokens: 100_000, cacheRead: 0 } }],
      passed: false,
      failed: [{ label: "old", ok: false, detail: "" }],
      future: [],
    };
    const out = rescore(record, scenario({ assert: [{ type: "must_call", tool: "shop" }] }), { input: 2, output: 10, cacheRead: 0.1 });
    expect(out.passed).toBe(true);
    expect(out.failed).toEqual([]);
    expect(out.turns[0].stats?.costUsd).toBeCloseTo(3);
  });
});
