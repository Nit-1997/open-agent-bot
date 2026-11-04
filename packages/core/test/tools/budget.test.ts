import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { TurnBudget, withBudget } from "../../src/tools/budget.js";
import { ok } from "../../src/tools/result.js";
import { textOf } from "../fixtures/toolResult.js";

const echo = (name: string) =>
  defineTool({
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    async execute() {
      return ok(`${name} ran`);
    },
  });

const call = (t: ReturnType<typeof echo>) => t.execute("c", {}, undefined, undefined, {} as never);

describe("withBudget", () => {
  it("allows calls up to the per-reply total, then refuses with guidance", async () => {
    const budget = new TurnBudget({}, { total: 2 });
    const t = withBudget(echo("web_search"), budget, "search");
    expect((await call(t)).isError).toBeFalsy();
    expect((await call(t)).isError).toBeFalsy();
    const third = await call(t);
    expect(third.isError).toBe(true);
    expect((third.content[0] as { text: string }).text).toBe(
      "Budget for web_search in this reply is used up (2 calls). Answer now with what you already have, and offer to look up more if needed.",
    );
  });

  it("all tools share the per-reply total", async () => {
    const budget = new TurnBudget({}, { total: 1 });
    const a = withBudget(echo("fetch_page"), budget, "read");
    const b = withBudget(echo("browse"), budget, "read");
    await call(a);
    expect((await call(b)).isError).toBe(true);
  });

  it("reset starts a fresh budget for the next reply", async () => {
    const budget = new TurnBudget({}, { total: 1 });
    const t = withBudget(echo("web_search"), budget, "search");
    await call(t);
    budget.reset();
    expect((await call(t)).isError).toBeFalsy();
  });
});

const text = (r: Awaited<ReturnType<typeof call>>) => (r.content.at(-1) as { text: string }).text;

describe("TurnBudget", () => {
  it("ends every result with the calls used and does not refuse under the total", async () => {
    const budget = new TurnBudget({ search: 2 }, { total: 5 });
    const t = withBudget(echo("web_search"), budget, "search");
    const r = await call(t);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe("web_search ran\n\n(budget: 1 of 5 calls used)");
  });

  it("treats group limits as guidance: a nudge instead of a failure", async () => {
    const budget = new TurnBudget({ search: 2 }, { total: 10 });
    const t = withBudget(echo("web_search"), budget, "search");
    await call(t);
    await call(t);
    const third = await call(t);
    expect(third.isError).toBeFalsy();
    expect(text(third)).toContain("web_search ran");
    expect(text(third)).toContain("this is search call 3 in this reply");
    expect(text(third)).toMatch(/\(budget: 3 of 10 calls used\)$/);
  });

  it("stops at the total cap with the answer-now failure", async () => {
    const budget = new TurnBudget({}, { total: 3 });
    const a = withBudget(echo("web_search"), budget, "search");
    const b = withBudget(echo("fetch_page"), budget, "read");
    await call(a);
    await call(b);
    await call(a);
    const r = await call(b);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(
      "Budget for fetch_page in this reply is used up (3 calls). Answer now with what you already have, and offer to look up more if needed.",
    );
  });

  it("stops after the wall time, using the injected clock", async () => {
    let now = 1000;
    const budget = new TurnBudget({}, { total: 50, wallMs: 240_000, now: () => now });
    const t = withBudget(echo("web_search"), budget, "search");
    now += 239_999;
    expect((await call(t)).isError).toBeFalsy();
    now += 1;
    const r = await call(t);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("used up (240s). Answer now");
  });

  it("reset starts the call count and the clock over for the next reply", async () => {
    let now = 0;
    const budget = new TurnBudget({}, { total: 1, wallMs: 1000, now: () => now });
    const t = withBudget(echo("web_search"), budget, "search");
    await call(t);
    expect((await call(t)).isError).toBe(true);
    now = 5000;
    budget.reset();
    expect(text(await call(t))).toContain("(budget: 1 of 1 calls used)");
  });

  it("defaults to 24 calls and 240 seconds", async () => {
    let now = 0;
    const budget = new TurnBudget({}, { now: () => now });
    const t = withBudget(echo("web_search"), budget, "search");
    for (let i = 0; i < 24; i++) expect((await call(t)).isError).toBeFalsy();
    expect(text(await call(t))).toContain("(24 calls)");
    budget.reset();
    now = 240_000;
    expect(text(await call(t))).toContain("(240s)");
  });

  it("adds the note as a new text part when the result has no text last", async () => {
    const budget = new TurnBudget({}, { total: 2 });
    const odd: ReturnType<typeof echo> = { ...echo("x"), execute: async () => ({ content: [], details: {} }) };
    const r = await withBudget(odd, budget, "g").execute("c", {}, undefined, undefined, {} as never);
    expect(textOf(r)).toBe("(budget: 1 of 2 calls used)");
  });
});
