import { describe, expect, it } from "vitest";
import { shopTool } from "../../src/tools/shop.js";

const run = async (region: string | undefined, params: Record<string, unknown>) => {
  const tool = shopTool({ pool: {} as never, threadId: "t", userContext: null, region });
  const r = await tool.execute("c", params as never, undefined, undefined, {} as never);
  return (r.content[0] as { text: string }).text;
};

describe("shop without stores on a new cart", () => {
  it("names the region's default stores so the retry picks them", async () => {
    const text = await run("IN", { items: [{ query: "OnePlus Nord 5", qty: 1 }] });
    expect(text).toContain("amazon.in, flipkart");
    expect(await run("US", { items: [{ query: "milk", qty: 1 }] })).toContain("groceries shipt; other products amazon, target");
  });
});
