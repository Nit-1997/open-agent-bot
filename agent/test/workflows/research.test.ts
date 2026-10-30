import { describe, expect, it } from "vitest";
import { noJudge } from "../../src/judge/index.js";
import { researchTool } from "../../src/tools/research.js";
import { parsePlan, type ResearchDeps, runResearch, type WorkflowStep } from "../../src/workflows/research.js";
import { numberJudge, REPORT, SOURCE_A, SOURCE_B } from "./fixtures.js";

const hit = (url: string) => ({ title: url, snippet: "", url });
const PAGES: Record<string, string> = { [SOURCE_A.url]: SOURCE_A.text.padEnd(300, " ."), [SOURCE_B.url]: SOURCE_B.text.padEnd(300, " .") };
const isPlan = (system: string) => system.startsWith("You plan");

function fakes(log: string[] = []): ResearchDeps & { steps: WorkflowStep[] } {
  const steps: WorkflowStep[] = [];
  return {
    steps,
    search: async (q) => {
      log.push(`search:${q}`);
      return [hit(SOURCE_A.url), hit(SOURCE_B.url), hit("https://dead.example.net/")];
    },
    read: async (url) => {
      log.push(`read:${url}`);
      return PAGES[url] ?? null;
    },
    complete: async ({ system }) => {
      log.push(isPlan(system) ? "plan" : "implement");
      return isPlan(system)
        ? '```json\n{"title":"Heat pump vs furnace","decision":"which to buy","takeaway":"Heat pump.","outline":["costs [1]"]}\n```'
        : `\`\`\`html\n${REPORT}\n\`\`\``;
    },
    judge: numberJudge(),
    publish: async (title, html) => {
      log.push(`publish:${title}`);
      expect(html).not.toContain("COP of 5.0");
      return { id: "abcdefghijkl" };
    },
    emit: (s) => {
      steps.push(s);
      log.push(`${s.phase}:${s.status}`);
    },
  };
}

const PHASES = [
  "research:start",
  "research:done",
  "plan:start",
  "plan:done",
  "implement:start",
  "implement:done",
  "verify:start",
  "verify:done",
];

describe("runResearch", () => {
  it("runs research, plan, implement, verify in order and publishes once", async () => {
    const log: string[] = [];
    const deps = fakes(log);
    const out = await runResearch({ question: "heat pump or furnace?", queries: ["heat pump cost", "furnace cost"] }, deps);
    expect(out).toMatchObject({
      ok: true,
      id: "abcdefghijkl",
      title: "Heat pump vs furnace",
      takeaway: "Heat pump.",
      sources: 2,
      flagged: 0,
      removed: 1,
    });
    expect(deps.steps.map((s) => `${s.phase}:${s.status}`)).toEqual(PHASES);
    const order = [
      "research:start",
      "research:done",
      "plan:start",
      "plan",
      "plan:done",
      "implement:start",
      "implement",
      "implement:done",
      "verify:start",
      "verify:done",
      "publish:Heat pump vs furnace",
    ];
    expect(log.filter((l) => order.includes(l))).toEqual(order);
    expect(log.filter((l) => l.startsWith("search:"))).toHaveLength(2);
    expect(deps.steps.at(-1)?.detail).toMatchObject({ total: 4, supported: 3 });
  });

  it("falls back to the top hits when the judge is unavailable and skips unreadable pages", async () => {
    const log: string[] = [];
    const out = await runResearch({ question: "q" }, { ...fakes(log), judge: noJudge, publish: async () => ({ id: "abcdefghijkl" }) });
    expect(out).toMatchObject({ ok: true, sources: 2 });
    expect(log).toContain("read:https://dead.example.net/");
    expect(log).toContain("search:q");
  });

  it("fails without publishing when nothing could be read", async () => {
    const deps = { ...fakes(), read: async () => null };
    expect(await runResearch({ question: "q" }, deps)).toEqual({ ok: false, error: "no readable sources were found for that question" });
    expect(deps.steps.map((s) => s.phase)).toEqual(["research"]);
  });
});

describe("research tool", () => {
  it("streams workflow steps through onUpdate and returns the artifact summary", async () => {
    const updates: unknown[] = [];
    const tool = researchTool({
      search: {
        searxngUrl: "http://searx.test",
        fetch: async () =>
          new Response(
            JSON.stringify({
              results: [
                { title: "a", url: SOURCE_A.url, content: "x" },
                { title: "b", url: SOURCE_B.url, content: "y" },
              ],
            }),
          ),
      },
      artifacts: { save: async () => ({ id: "abcdefghijkl" }) } as never,
      complete: async ({ system }) => (isPlan(system) ? '{"title":"T","takeaway":"Heat pump.","outline":[]}' : REPORT),
      judge: numberJudge(),
      fetchPage: {
        execute: async (_i: string, p: { url: string }) => ({
          content: [{ type: "text", text: `url: ${p.url}\n\n${PAGES[p.url] ?? ""}` }],
          details: {},
          isError: !PAGES[p.url],
        }),
      } as never,
    });
    const r = await tool.execute("c1", { question: "q" }, undefined, (u) => updates.push(u), undefined as never);
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toMatchObject({
      text: expect.stringMatching(
        /^artifact abcdefghijkl created: T\nRead 2 sources\. 4 claims checked against their sources: 3 supported, 1 unsupported removed/,
      ),
    });
    const steps = updates.map((u) => (u as { details: { workflowStep: WorkflowStep } }).details.workflowStep);
    expect(steps.map((s) => `${s.phase}:${s.status}`)).toEqual(PHASES);
  });
});

describe("parsePlan", () => {
  it("keeps the title and takeaway when the plan reply was cut off mid-outline", () => {
    const raw =
      '```json\n{"title": "Heat pump vs furnace", "decision": "Which to install", "takeaway": "A heat pump costs less to run \\"here\\".", "outline": ["costs [1]", "rebates [2';
    expect(parsePlan(raw, "q")).toEqual({
      title: "Heat pump vs furnace",
      decision: "Which to install",
      takeaway: 'A heat pump costs less to run "here".',
      outline: [],
    });
  });
});
