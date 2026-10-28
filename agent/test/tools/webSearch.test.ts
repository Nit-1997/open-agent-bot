import { describe, expect, it } from "vitest";
import { webSearchTool } from "../../src/tools/webSearch.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

const results = Array.from({ length: 20 }, (_, i) => ({ title: `T${i + 1}`, url: `https://e.com/${i + 1}`, content: `snippet ${i + 1}` }));

describe("web_search", () => {
  it("web_search formats results and caps count at 15", async () => {
    const f = fakeFetch([[/search\.local\/search/, () => json({ results })]]);
    const r = await webSearchTool({ searxngUrl: "http://search.local", fetch: f }).execute(
      "c",
      { query: "diwali sweets", count: 50 },
      undefined,
      undefined,
      {} as never,
    );
    const t = (r.content[0] as { text: string }).text;
    expect(t.startsWith("1. T1 — https://e.com/1\n   snippet 1")).toBe(true);
    expect(t).toContain("15. T15");
    expect(t).not.toContain("16. T16");
    const u = new URL(f.calls[0]);
    expect(u.searchParams.get("q")).toBe("diwali sweets");
    expect(u.searchParams.get("format")).toBe("json");
  });

  it("includes a result's image when the engine has one", async () => {
    const f = fakeFetch([[/search/, () => json({ results: [{ title: "Boot", url: "https://s.com/b", content: "TF", thumbnail: "https://img.s.com/b.jpg" }] })]]);
    const r = await webSearchTool({ searxngUrl: "http://search.local", fetch: f }).execute("c", { query: "boot" }, undefined, undefined, {} as never);
    expect((r.content[0] as { text: string }).text).toBe("1. Boot — https://s.com/b\n   TF\n   image: https://img.s.com/b.jpg");
  });

  it("defaults to 8 results", async () => {
    const f = fakeFetch([[/search/, () => json({ results })]]);
    const r = await webSearchTool({ searxngUrl: "http://search.local", fetch: f }).execute("c", { query: "x" }, undefined, undefined, {} as never);
    const t = (r.content[0] as { text: string }).text;
    expect(t).toContain("8. T8");
    expect(t).not.toContain("9. T9");
  });

  it("reports no results", async () => {
    const f = fakeFetch([[/search/, () => json({ results: [] })]]);
    const r = await webSearchTool({ searxngUrl: "http://search.local", fetch: f }).execute("c", { query: "x" }, undefined, undefined, {} as never);
    expect((r.content[0] as { text: string }).text).toBe('no results for "x"');
  });
});
