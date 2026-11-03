import { describe, expect, it } from "vitest";
import { testConfig } from "../fixtures/config.js";
import { TurnBudget } from "../../src/tools/budget.js";
import { buildTools, PER_REPLY_LIMITS } from "../../src/tools/index.js";

const ctx = { timeZone: "Asia/Kolkata", locale: "en-IN", localTime: "2026-10-27T14:00" };

function tools(userContext = ctx) {
  return buildTools({
    cfg: testConfig(),
    artifacts: {} as never,
    pool: {} as never,
    threadId: "t",
    userContext,
    budget: new TurnBudget(PER_REPLY_LIMITS),
  });
}
const desc = (list: ReturnType<typeof tools>, name: string) => list.find((t) => t.name === name)!.description;

describe("tool descriptions", () => {
  it("include load_skill and the per-tool rules", () => {
    const all = tools();
    expect(all.map((t) => t.name)).toContain("load_skill");
    expect(desc(all, "weather")).toContain("call it typical");
    expect(desc(all, "flights")).toContain("nearby");
    expect(desc(all, "flights")).not.toContain("SJC");
    expect(desc(all, "stays")).toContain("Don't browse booking sites");
    expect(desc(all, "shop")).toContain("pass only the new items");
    expect(desc(all, "shop").match(/pass only the new items|pass just the new items/g)).toHaveLength(1);
    expect(desc(all, "shop")).toContain(
      "To re-price the whole cart, or to continue a cart from an earlier card, pass new_cart with its items and stores.",
    );
    expect(desc(all, "flights").match(/rideshare/g)).toHaveLength(1);
    expect(desc(all, "show_ui")).toContain("one card per item");
    expect(desc(all, "ask_user")).toContain("don't search until they answer");
    expect(desc(all, "create_artifact")).toContain("load_skill research");
    expect(desc(all, "create_artifact")).not.toContain("Design: the page is styled");
  });

  it("list the default stores for the user's region", () => {
    expect(desc(tools(), "shop")).toContain("groceries amazon.in, flipkart");
    const us = tools({ ...ctx, timeZone: "America/Los_Angeles", locale: "en-US" });
    expect(desc(us, "shop")).toContain("groceries shipt; other products amazon, target");
    expect(desc(us, "shop")).toContain("Groceries from a store shipt carries: pass shipt");
    expect(desc(tools(), "shop")).not.toContain("Groceries from a store");
  });

  it("list the shop stores for the user's region from the registry", () => {
    const d = desc(tools(), "shop");
    expect(d).toContain("Stores for the user's region: amazon, amazon.in, flipkart.");
    expect(d).not.toContain("walmart");
  });
});
