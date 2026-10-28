import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fail, ok, type ToolResult } from "./result.js";

type Deps = { searxngUrl: string; fetch?: typeof fetch };

export function webSearchTool(deps: Deps) {
  const f = deps.fetch ?? fetch;
  return defineTool({
    name: "web_search",
    label: "Web search",
    description: "Search the web. Returns titles, URLs, and snippets. Use fetch_page or browse to read a result.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      count: Type.Optional(Type.Number({ description: "results to return, default 8, max 15" })),
    }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const count = Math.min(Math.max(Math.floor(params.count ?? 8), 1), 15);
      const url = new URL("/search", deps.searxngUrl);
      url.searchParams.set("q", params.query);
      url.searchParams.set("format", "json");
      try {
        const res = await f(url, { signal: signal ?? AbortSignal.timeout(15000) });
        if (!res.ok) return fail(`search failed: HTTP ${res.status}`);
        const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string; thumbnail?: string; img_src?: string }> };
        const results = (data.results ?? []).filter((r) => r.url).slice(0, count);
        if (!results.length) return ok(`no results for "${params.query}"`);
        const text = results
          .map((r, i) => {
            const image = r.thumbnail || r.img_src;
            return `${i + 1}. ${r.title ?? r.url} — ${r.url}${r.content ? `\n   ${r.content.trim()}` : ""}${image ? `\n   image: ${image}` : ""}`;
          })
          .join("\n");
        return ok(text, { results });
      } catch (err) {
        return fail(`search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
