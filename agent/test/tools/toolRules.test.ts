import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ToolBudget } from "../../src/tools/budget.js";
import { buildTools, PER_REPLY_LIMITS } from "../../src/tools/index.js";

const ctx = { timeZone: "Asia/Kolkata", locale: "en-IN", localTime: "2026-10-27T14:00" };

function tools(promptV2: boolean, userContext = ctx) {
  const cfg = loadConfig({ PROMPT_V2: promptV2 ? "1" : "0" } as NodeJS.ProcessEnv);
  return buildTools({ cfg, artifacts: {} as never, pool: {} as never, threadId: "t", userContext, budget: new ToolBudget(PER_REPLY_LIMITS) });
}
const desc = (list: ReturnType<typeof tools>, name: string) => list.find((t) => t.name === name)!.description;

describe("tool descriptions behind promptV2", () => {
  it("leaves every description and the tool set as they were when off", () => {
    const off = tools(false);
    expect(off.map((t) => t.name)).not.toContain("load_skill");
    expect(desc(off, "shop")).not.toContain("defaults for their region");
    expect(desc(off, "weather")).not.toContain("call it typical");
    expect(desc(off, "flights")).toContain("SJC, SFO, OAK");
  });

  it("adds load_skill and the moved rules when on", () => {
    const on = tools(true);
    expect(on.map((t) => t.name)).toContain("load_skill");
    expect(desc(on, "weather")).toContain("call it typical");
    expect(desc(on, "flights")).toContain("nearby");
    expect(desc(on, "flights")).not.toContain("SJC");
    expect(desc(on, "stays")).toContain("Don't browse booking sites");
    expect(desc(on, "shop")).toContain("pass only the new items");
    expect(desc(on, "show_ui")).toContain("one card per item");
    expect(desc(on, "ask_user")).toContain("don't search until they answer");
    expect(desc(on, "create_artifact")).toContain("load_skill research");
    expect(desc(on, "create_artifact")).not.toContain("Design: the page is styled");
  });

  it("lists the default stores for the user's region", () => {
    expect(desc(tools(true), "shop")).toContain("groceries amazon.in, flipkart");
    const us = tools(true, { ...ctx, timeZone: "America/Los_Angeles", locale: "en-US" });
    expect(desc(us, "shop")).toContain("groceries shipt; other products amazon, target");
  });
});
