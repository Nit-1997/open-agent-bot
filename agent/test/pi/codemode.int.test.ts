import { mkdtempSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool, type ModelRuntime, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codemodeFailure, createPiSession } from "../../src/pi/createPiSession.js";
import { ProviderHub } from "../../src/providers/hub.js";
import { TurnBudget, withBudget } from "../../src/tools/budget.js";
import { fetchPageTool } from "../../src/tools/fetchPage.js";
import { scopeToCodemode } from "../../src/tools/index.js";
import { fail } from "../../src/tools/result.js";

let server: Server;
let hub: ProviderHub;
let script = "";
let toolNamesSeen: string[][] = [];

const reply = (res: ServerResponse, delta: object, finish: string) => {
  const chunk = (d: object, f: string | null) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: d, finish_reason: f }] })}\n\n`;
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(chunk(delta, null));
  res.write(chunk({}, finish));
  res.end("data: [DONE]\n\n");
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return res.writeHead(404).end();
      const body = JSON.parse(raw) as { messages: { role: string }[]; tools?: { function: { name: string } }[] };
      toolNamesSeen.push((body.tools ?? []).map((t) => t.function.name));
      if (body.messages.at(-1)?.role === "tool") return reply(res, { role: "assistant", content: "done" }, "stop");
      reply(res, { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "codemode", arguments: JSON.stringify({ code: script }) } }] }, "tool_calls");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  hub = await ProviderHub.create({
    dataDir: mkdtempSync(join(tmpdir(), "codemode-")),
    litellm: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: "none", models: [{ id: "m", label: "m" }, { id: "q", label: "q" }] },
  });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

function fakeTool(name: string, hits: string[]): ToolDefinition<any, any, any> {
  return defineTool({
    name,
    label: name,
    description: `fake ${name}`,
    parameters: Type.Object({ q: Type.Optional(Type.String()) }),
    async execute(_id, p) {
      hits.push(`${name}:${p.q ?? ""}`);
      return { content: [{ type: "text", text: `${name} ok ${p.q ?? ""}` }], details: {} };
    },
  });
}

type Call = { name: string; status: string; error?: string; cost?: number };
type CodemodeRun = { text: string; failed: boolean; details: { calls: Call[]; fullOutputPath?: string }; usage?: { cost: { total: number } }; nested?: { name?: string }[] };

async function run(code: string, tools: ToolDefinition<any, any, any>[], runtime: ModelRuntime = hub.runtime): Promise<CodemodeRun> {
  script = code;
  const model = hub.resolve("litellm/m");
  if (!model) throw new Error("no model");
  const handle = await createPiSession({ runtime, model, systemPrompt: "sys", tools: scopeToCodemode(tools), codemode: () => true });
  let out: CodemodeRun | undefined;
  handle.session.subscribe((e) => {
    if (e.type === "tool_execution_end" && e.toolName === "codemode") {
      const r = e.result as { content: { text?: string }[]; details: CodemodeRun["details"] };
      out = { text: r.content.map((c) => c.text ?? "").join("\n"), failed: e.isError, details: r.details };
    }
    if (e.type === "message_end" && (e.message as { role: string }).role === "toolResult" && out) {
      out.usage = (e.message as { usage?: { cost: { total: number } } }).usage;
    }
  });
  try {
    await handle.session.prompt("go");
  } finally {
    await handle.dispose();
  }
  if (!out) throw new Error("codemode did not run");
  return out;
}

describe("codemode sandbox guards", () => {
  it("has no network: fetch is not defined", async () => {
    const r = await run(`const res = await fetch("http://127.0.0.1:1/"); return res.status;`, []);
    expect(r.failed).toBe(true);
    expect(r.text).toContain("Script failed");
    expect(r.text).toContain("fetch is not defined");
  }, 60000);

  it("stops a looping script at timeout_ms", async () => {
    const started = Date.now();
    const r = await run(`// @options: {"timeout_ms": 500}\nwhile (true) {}`, []);
    expect(r.failed).toBe(true);
    expect(r.text).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(20000);
  }, 60000);

  it("caps output at max_output_tokens and keeps the full text in a file", async () => {
    const r = await run(`// @options: {"max_output_tokens": 50}\nreturn "x".repeat(20000);`, []);
    expect(r.failed).toBe(false);
    expect(r.text.length).toBeLessThan(3000);
    expect(r.details.fullOutputPath).toBeTruthy();
  }, 60000);

  it("rejects a tool that is not on the allow-list and never runs it", async () => {
    const hits: string[] = [];
    const r = await run(`try { await tools.show_ui({ q: "x" }); return "called"; } catch (e) { return "rejected: " + e.message; }`, [fakeTool("show_ui", hits), fakeTool("weather", hits)]);
    expect(hits).toEqual([]);
    expect(r.text).toContain("rejected: tools.show_ui does not exist");
  }, 60000);

  it("shows a number a script returns, so math done in a script reaches the model", async () => {
    const r = await run(`return (129.99*3 + 45.5*2)*1.08;`, []);
    expect(r.failed).toBe(false);
    expect(r.text).toContain("519.44");
  }, 60000);

  it("runs an allow-listed tool", async () => {
    const hits: string[] = [];
    const r = await run(`return await tools.weather({ q: "Paris" });`, [fakeTool("weather", hits), fakeTool("show_ui", hits)]);
    expect(hits).toEqual(["weather:Paris"]);
    expect(r.text).toContain("weather ok Paris");
  }, 60000);

  it("applies the per-reply budget to calls made from a script", async () => {
    const hits: string[] = [];
    const budget = new TurnBudget({}, { total: 2 });
    const search = withBudget(fakeTool("web_search", hits), budget, "search");
    const r = await run(`const rs = await Promise.allSettled([1,2,3,4].map((i) => tools.web_search({ q: "q" + i }))); return rs.map((x) => x.status === "fulfilled" ? "ok" : "budget:" + /used up/.test(String(x.reason))).join(",");`, [search]);
    expect(hits).toHaveLength(2);
    expect(r.text).toContain("ok,ok,budget:true,budget:true");
  }, 60000);

  it("counts script tool calls against the turn budget", async () => {
    const hits: string[] = [];
    const budget = new TurnBudget({}, { total: 3 });
    const search = withBudget(fakeTool("web_search", hits), budget, "search");
    const r = await run(`let n = 0; for (let i = 0; i < 5; i++) { try { await tools.web_search({ q: String(i) }); n++; } catch (e) {} } return n;`, [search]);
    expect(hits).toHaveLength(3);
    expect(r.text).toContain("3");
  }, 60000);

  it("keeps the net guard on fetch_page calls made from a script", async () => {
    const r = await run(`try { await tools.fetch_page({ url: "http://127.0.0.1:9/secret" }); return "fetched"; } catch (e) { return "blocked: " + e.message; }`, [fetchPageTool()]);
    expect(r.text).toContain("blocked");
    expect(r.text).not.toContain("fetched");
  }, 60000);

  it("counts classifier usage from a script in the tool result", async () => {
    const fake = new Proxy(hub.runtime, {
      get(target, prop, receiver) {
        if (prop === "getModelOfType") return (type: string, provider: string, id: string) => (type === "classifier" ? { type, provider, id, name: id, api: "x", input: ["text"] } : undefined);
        if (prop === "classify")
          return async () => ({ provider: "openrouter", model: "jev", answers: { q: { type: "bool", probability: 0.9 } }, usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 } }, stopReason: "stop" });
        return Reflect.get(target, prop, receiver);
      },
    });
    const r = await run(
      `const jev = await models.getModelOfType("classifier", "openrouter", "typesafe/jev-1.14");
const rs = await Promise.all([1, 2, 3].map((i) => models.classify(jev, { state: { i }, questions: { q: { type: "bool", instructions: "ok?", criteria: { true: "yes", false: "no" } } } })));
return rs.map((x) => x.answers.q.probability);`,
      [],
      fake as ModelRuntime,
    );
    expect(r.failed).toBe(false);
    expect(r.details.calls.filter((c) => c.name.startsWith("models.")).map((c) => c.cost)).toEqual([0.002, 0.002, 0.002]);
    expect(r.usage?.cost.total).toBeCloseTo(0.006, 6);
  }, 60000);
});

describe.skipIf(!process.env.OPENROUTER_API_KEY)("codemode with the live classifier", () => {
  it("judges items with Jev from a script and reports its cost", async () => {
    const r = await run(
      `const jev = await models.getModelOfType("classifier", "openrouter", "typesafe/jev-1.14");
const rs = await Promise.all(["Green Table: full vegetarian menu, books groups of 10", "Beef Barn: steakhouse, walk-in only"].map((hit) => models.classify(jev, { state: { hit }, questions: { veg: { type: "bool", instructions: "Is this a good place for vegetarians?", criteria: { true: "means: a vegetarian menu or several vegetarian mains", false: "not: meat focused" } } } })));
return JSON.stringify(rs.map((x) => x.answers?.veg?.probability ?? -1));`,
      [],
    );
    expect(r.failed).toBe(false);
    const [a, b] = JSON.parse(r.text.slice(r.text.indexOf("["))) as number[];
    expect(a).toBeGreaterThan(b);
    expect(r.usage?.cost.total ?? 0).toBeGreaterThan(0);
  }, 90000);
});

describe("codemode availability follows the model", () => {
  it("is active only for capable models and follows model switches", async () => {
    const m = hub.resolve("litellm/m");
    const q = hub.resolve("litellm/q");
    if (!m || !q) throw new Error("no model");
    const capable = (x: { id: string }) => x.id === "m";
    const handle = await createPiSession({ runtime: hub.runtime, model: q, systemPrompt: "sys", tools: scopeToCodemode([fakeTool("weather", [])]), codemode: capable });
    try {
      expect(handle.session.getActiveToolNames()).not.toContain("codemode");
      expect(handle.session.getActiveToolNames()).toContain("weather");
      await handle.setModel(m);
      expect(handle.session.getActiveToolNames()).toContain("codemode");
      await handle.setModel(q);
      expect(handle.session.getActiveToolNames()).not.toContain("codemode");
      toolNamesSeen = [];
      script = "return 1";
      await handle.session.prompt("hi");
      expect(toolNamesSeen.flat()).not.toContain("codemode");
      await handle.setModel(m);
      toolNamesSeen = [];
      await handle.session.prompt("hi again");
      expect(toolNamesSeen[0]).toContain("codemode");
    } finally {
      await handle.dispose();
    }
  }, 60000);

  it("leaves tools untouched without the codemode option", async () => {
    const m = hub.resolve("litellm/m");
    if (!m) throw new Error("no model");
    const handle = await createPiSession({ runtime: hub.runtime, model: m, systemPrompt: "sys", tools: [fakeTool("weather", [])] });
    try {
      expect(handle.session.getActiveToolNames()).toEqual(["weather"]);
    } finally {
      await handle.dispose();
    }
  });
});

describe("codemode switches itself off for the chat when a script goes wrong", () => {
  function failingTool(name: string, text: string): ToolDefinition<any, any, any> {
    return defineTool({ name, label: name, description: `fake ${name}`, parameters: Type.Object({ q: Type.Optional(Type.String()) }), execute: async () => fail(text) });
  }

  async function prompted(code: string, tools: ToolDefinition<any, any, any>[]) {
    const model = hub.resolve("litellm/m");
    if (!model) throw new Error("no model");
    const reasons: string[] = [];
    const handle = await createPiSession({ runtime: hub.runtime, model, systemPrompt: "sys", tools: scopeToCodemode(tools), codemode: () => true, onCodemodeOff: (r) => reasons.push(r) });
    script = code;
    toolNamesSeen = [];
    try {
      await handle.session.prompt("go");
      return { reasons, seen: toolNamesSeen, active: handle.codemodeActive(), handle };
    } finally {
      await handle.dispose();
    }
  }

  it("drops codemode before the next model call when a tool inside the script fails", async () => {
    const r = await prompted(`const rs = await Promise.allSettled(["a", "b"].map((q) => tools.weather({ q }))); return rs.map((x) => x.status).join(",");`, [failingTool("weather", "weather service error: HTTP 429")]);
    expect(r.reasons).toEqual(["2 tool call(s) in the script failed (weather)"]);
    expect(r.seen[0]).toContain("codemode");
    expect(r.seen.at(-1)).not.toContain("codemode");
    expect(r.seen.at(-1)).toContain("weather");
    expect(r.active).toBe(false);
  }, 60000);

  it("drops codemode when the script itself throws", async () => {
    const r = await prompted(`throw new Error("bad script");`, []);
    expect(r.reasons).toEqual(["the script failed"]);
    expect(r.active).toBe(false);
  }, 60000);

  it("keeps codemode after a clean script or a per-reply limit refusal", async () => {
    const clean = await prompted(`return await tools.weather({ q: "Rome" });`, [fakeTool("weather", [])]);
    expect(clean.reasons).toEqual([]);
    expect(clean.active).toBe(true);
    const budget = new TurnBudget({}, { total: 0 });
    const limited = await prompted(`try { await tools.web_search({ q: "x" }); } catch {} return "ok";`, [withBudget(fakeTool("web_search", []), budget, "search")]);
    expect(limited.reasons).toEqual([]);
    expect(limited.active).toBe(true);
  }, 60000);
});

describe("codemodeFailure", () => {
  it("names failed calls and ignores cancelled ones and budget refusals", () => {
    const details = (calls: { name: string; status: string; error?: string }[]) => ({ details: { calls } });
    expect(codemodeFailure(false, details([{ name: "weather", status: "ok" }]))).toBeUndefined();
    expect(codemodeFailure(false, details([{ name: "weather", status: "cancelled" }]))).toBeUndefined();
    expect(codemodeFailure(false, details([{ name: "web_search", status: "error", error: "Budget for web_search in this reply is used up" }]))).toBeUndefined();
    expect(codemodeFailure(false, details([{ name: "weather", status: "error" }, { name: "music", status: "error" }]))).toBe("2 tool call(s) in the script failed (weather, music)");
    expect(codemodeFailure(true, undefined)).toBe("the script failed");
  });
});
