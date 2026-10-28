import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { liveSession } from "./liveSession.js";

const live = !!process.env.LLM_BASE_URL;

describe.skipIf(!live)("parallel tool calls through LiteLLM (live)", () => {
  it("three parallel searches arrive as three valid calls, none merged", async () => {
    const queries: string[] = [];
    const search = defineTool({
      name: "web_search",
      label: "search",
      description: "search the web",
      parameters: Type.Object({ query: Type.String() }),
      async execute(_id, p) {
        queries.push(p.query);
        return { content: [{ type: "text", text: `results for ${p.query}` }], details: {} };
      },
    });
    const errors: string[] = [];
    const handle = await liveSession("You call tools exactly as asked.", [search]);
    handle.session.subscribe((e) => {
      if (e.type === "tool_execution_end" && e.isError) errors.push(JSON.stringify(e.result).slice(0, 200));
    });
    try {
      await handle.session.prompt("Run three separate web searches in parallel right now: samosa recipe, chakli recipe, diwali games. Then reply 'done'.");
      expect(errors).toEqual([]);
      expect(queries.length).toBeGreaterThanOrEqual(3);
    } finally {
      await handle.dispose();
    }
  }, 180000);
});
