import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { ToolBudget, withBudget } from "../../src/tools/budget.js";
import { ok } from "../../src/tools/result.js";

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
  it("allows calls up to the group limit, then refuses with guidance", async () => {
    const budget = new ToolBudget({ search: 2 });
    const t = withBudget(echo("web_search"), budget, "search");
    expect((await call(t)).content[0]).toMatchObject({ text: "web_search ran" });
    expect((await call(t)).content[0]).toMatchObject({ text: "web_search ran" });
    const third = await call(t);
    expect(third.isError).toBe(true);
    expect((third.content[0] as { text: string }).text).toBe(
      "Budget for web_search in this reply is used up (2). Answer now with what you already have, and offer to look up more if needed.",
    );
  });

  it("tools in the same group share the limit", async () => {
    const budget = new ToolBudget({ read: 1 });
    const a = withBudget(echo("fetch_page"), budget, "read");
    const b = withBudget(echo("browse"), budget, "read");
    await call(a);
    expect((await call(b)).isError).toBe(true);
  });

  it("reset starts a fresh budget for the next reply", async () => {
    const budget = new ToolBudget({ search: 1 });
    const t = withBudget(echo("web_search"), budget, "search");
    await call(t);
    budget.reset();
    expect((await call(t)).isError).toBeFalsy();
  });
});
