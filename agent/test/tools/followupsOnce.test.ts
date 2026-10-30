import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ToolBudget, TurnBudget } from "../../src/tools/budget.js";
import { buildTools, HARD_LIMITS, PER_REPLY_LIMITS } from "../../src/tools/index.js";

const ctx = { timeZone: "America/Los_Angeles", locale: "en-US", localTime: "2026-10-29T10:00" };

describe("suggest_replies", () => {
  it("runs once per reply under either budget, so a model can't loop on it", async () => {
    for (const budget of [new ToolBudget({ ...PER_REPLY_LIMITS, ...HARD_LIMITS }), new TurnBudget(PER_REPLY_LIMITS, { hard: HARD_LIMITS })]) {
      const tool = buildTools({ cfg: loadConfig({}), artifacts: {} as never, pool: {} as never, threadId: "t", userContext: ctx, budget }).find((t) => t.name === "suggest_replies")!;
      const call = () => tool.execute("c", { replies: ["Cheaper", "Closer"] } as never, undefined, undefined, {} as never);
      expect((await call()).isError).toBeFalsy();
      const again = await call();
      expect(again.isError).toBe(true);
      expect((again.content[0] as { text: string }).text).toContain("Your reply is complete");
      budget.reset();
      expect((await call()).isError).toBeFalsy();
    }
  });
});
