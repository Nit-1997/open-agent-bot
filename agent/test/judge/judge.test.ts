import { describe, expect, it } from "vitest";
import { createJudge, noJudge, scopeJudge } from "../../src/judge/index.js";
import { productMatch } from "../../src/judge/criteria/productMatch.js";

type Call = { state: Record<string, unknown>; questions: Record<string, any> };

function fakeRuntime(opts: { models?: { provider: string; id: string }[]; classify?: (ctx: Call, signal?: AbortSignal) => Promise<any> } = {}) {
  const calls: Call[] = [];
  const runtime = {
    getAvailableOfType: async () => opts.models ?? [{ provider: "openrouter", id: "typesafe/jev-1.14" }],
    classify: async (_m: unknown, ctx: Call, o?: { signal?: AbortSignal }) => {
      calls.push(ctx);
      return opts.classify ? opts.classify(ctx, o?.signal) : choice("exact", 0.9);
    },
  };
  return { runtime: runtime as any, calls };
}

const choice = (label: string, p: number, cost = 0.00002) => ({
  stopReason: "stop",
  usage: { cost: { total: cost } },
  answers: { q: { type: "choice", choice: label, probabilities: { [label]: p }, confidence: p } },
});

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, state: { query: "milk", title: `Milk ${i}` } }));

describe("createJudge", () => {
  it("is unavailable when the model is missing or the ref is malformed", async () => {
    expect((await createJudge({ runtime: fakeRuntime({ models: [] }).runtime, model: "openrouter/typesafe/jev-1.14" })).available).toBe(false);
    expect((await createJudge({ runtime: fakeRuntime().runtime, model: "nonsense" })).available).toBe(false);
  });

  it("splits the model ref on the first slash", async () => {
    const judge = await createJudge({ runtime: fakeRuntime().runtime, model: "openrouter/typesafe/jev-1.14" });
    expect(judge.available).toBe(true);
  });

  it("scores items with one choice question each and logs the decision", async () => {
    const { runtime, calls } = fakeRuntime();
    const log: string[] = [];
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: (l) => log.push(l) });
    const out = await judge.score(items(2), productMatch);
    expect(out).toEqual([
      { id: "t0", level: "exact", p: 0.9, probabilities: { exact: 0.9 } },
      { id: "t1", level: "exact", p: 0.9, probabilities: { exact: 0.9 } },
    ]);
    expect(calls[0].questions.q.type).toBe("choice");
    expect(Object.keys(calls[0].questions.q.criteria)).toEqual(["exact", "substitute", "complement", "irrelevant"]);
    expect(calls[0].questions.q.criteria.exact).toContain(" Not: ");
    expect(log[0]).toMatch(/^\[jev\] \{"c":"productMatch@2","h":"[0-9a-f]{8}","ans":"exact","p":0.9,"ms":\d+\}$/);
  });

  it("returns null and logs a timeout when a call hangs", async () => {
    const { runtime } = fakeRuntime({ classify: () => new Promise(() => {}) });
    const log: string[] = [];
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", timeoutMs: 30, log: (l) => log.push(l) });
    expect(await judge.score(items(1), productMatch)).toBeNull();
    expect(log[0]).toContain('"error":"timeout"');
    expect(judge.usage().failures).toBe(1);
  });

  it("returns null on a provider error stop reason", async () => {
    const { runtime } = fakeRuntime({ classify: async () => ({ stopReason: "error", errorMessage: "402 out of credit", answers: {} }) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    expect(await judge.score(items(2), productMatch)).toBeNull();
    expect(await judge.yesno(items(1), { id: "x", version: "1", question: "q", yes: "y", no: "n" })).toBeNull();
    expect(await judge.choose({}, { a: "A" }, { id: "x", version: "1", question: "q" })).toBeNull();
  });

  it("returns null when any item fails", async () => {
    let n = 0;
    const { runtime } = fakeRuntime({ classify: async () => (n++ === 1 ? { stopReason: "error", answers: {} } : choice("exact", 0.8)) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    expect(await judge.score(items(3), productMatch)).toBeNull();
  });

  it("rejects an answer outside the declared levels", async () => {
    const { runtime } = fakeRuntime({ classify: async () => choice("bogus", 0.9) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    expect(await judge.score(items(1), productMatch)).toBeNull();
  });

  it("never has more than the concurrency cap in flight", async () => {
    let live = 0;
    let peak = 0;
    const { runtime } = fakeRuntime({
      classify: async () => {
        peak = Math.max(peak, ++live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return choice("exact", 0.9);
      },
    });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    expect(await judge.score(items(12), productMatch)).toHaveLength(12);
    expect(peak).toBe(4);
  });

  it("sums calls and cost", async () => {
    const { runtime } = fakeRuntime();
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    await judge.score(items(3), productMatch);
    expect(judge.usage().calls).toBe(3);
    expect(judge.usage().costUsd).toBeCloseTo(0.00006, 8);
  });

  it("yesno thresholds the bool probability", async () => {
    const { runtime } = fakeRuntime({ classify: async () => ({ stopReason: "stop", answers: { q: { type: "bool", probability: 0.7 } } }) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    expect(await judge.yesno(items(1), { id: "x", version: "1", question: "q", yes: "y", no: "n" })).toEqual([{ id: "t0", yes: true, p: 0.7 }]);
  });

  it("choose maps the none option to null", async () => {
    const { runtime } = fakeRuntime({ classify: async () => choice("none", 0.8) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    expect(await judge.choose({}, { a: "A" }, { id: "x", version: "1", question: "q", none: "nothing fits" })).toEqual({ choice: null, p: 0.8 });
  });
});

describe("batched score", () => {
  const multi = (n: number, label = "exact") => ({
    stopReason: "stop",
    usage: { cost: { total: 0.0003 } },
    answers: Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, { type: "choice", choice: label, probabilities: { [label]: 0.8 }, confidence: 0.8 }])),
  });

  it("asks one question per tile in a single call and keeps item order", async () => {
    const { runtime, calls } = fakeRuntime({ classify: async (ctx) => multi(Object.keys(ctx.questions).length) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    const out = await judge.score(items(5), productMatch, { batch: { shared: { query: "milk" } } });
    expect(out?.map((s) => s.id)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].questions)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(calls[0].state.query).toBe("milk");
    expect((calls[0].state.tiles as unknown[]).length).toBe(5);
    expect(judge.usage().calls).toBe(1);
  });

  it("splits into several calls above the per-call cap", async () => {
    const { runtime, calls } = fakeRuntime({ classify: async (ctx) => multi(Object.keys(ctx.questions).length) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    const out = await judge.score(items(7), productMatch, { batch: { shared: {}, max: 3 } });
    expect(out).toHaveLength(7);
    expect(calls).toHaveLength(3);
  });

  it("falls back to one call per item when the batched call fails", async () => {
    const { runtime, calls } = fakeRuntime({ classify: async (ctx) => (ctx.questions.t0 ? { stopReason: "error", answers: {} } : choice("substitute", 0.7)) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    const out = await judge.score(items(3), productMatch, { batch: { shared: {} } });
    expect(out?.map((s) => s.level)).toEqual(["substitute", "substitute", "substitute"]);
    expect(calls).toHaveLength(4);
  });

  it("falls back when a tile is missing from the batched answer", async () => {
    const { runtime } = fakeRuntime({ classify: async (ctx) => (ctx.questions.t0 ? multi(1) : choice("exact", 0.9)) });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    expect(await judge.score(items(2), productMatch, { batch: { shared: {} } })).toHaveLength(2);
  });
});

describe("scopeJudge", () => {
  it("counts only its own calls and resets per turn", async () => {
    const { runtime } = fakeRuntime();
    const base = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    const a = scopeJudge(base);
    const b = scopeJudge(base);
    await a.score(items(2), productMatch);
    await b.score(items(1), productMatch);
    expect(a.usage().calls).toBe(2);
    expect(b.usage().calls).toBe(1);
    expect(base.usage().calls).toBe(3);
    a.reset();
    expect(a.usage()).toEqual({ calls: 0, failures: 0, costUsd: 0 });
  });

  it("shares one in-flight cap across parallel score calls", async () => {
    let live = 0;
    let peak = 0;
    const { runtime } = fakeRuntime({
      classify: async () => {
        peak = Math.max(peak, ++live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return choice("exact", 0.9);
      },
    });
    const judge = await createJudge({ runtime, model: "openrouter/typesafe/jev-1.14", log: () => {} });
    await Promise.all([judge.score(items(6), productMatch), judge.score(items(6), productMatch), judge.score(items(6), productMatch)]);
    expect(peak).toBe(4);
  });
});

describe("noJudge", () => {
  it("is unavailable and every call falls back", async () => {
    expect(noJudge.available).toBe(false);
    expect(await noJudge.score(items(1), productMatch)).toBeNull();
    expect(await noJudge.choose({}, {}, { id: "x", version: "1", question: "q" })).toBeNull();
    expect(noJudge.usage()).toEqual({ calls: 0, failures: 0, costUsd: 0 });
  });
});
