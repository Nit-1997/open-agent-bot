import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fail, ok, type ToolResult } from "./result.js";

type Deps = { searxngUrl: string; braveApiKey?: string; fetch?: typeof fetch };
type Hit = { title: string; url: string; snippet?: string; image?: string };
type Kind = "web" | "images";

type SearxResult = { title?: string; url?: string; content?: string; thumbnail?: string; thumbnail_src?: string; img_src?: string };
type BraveResult = { title?: string; url?: string; description?: string; thumbnail?: { src?: string } };

const timeout = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000));

async function searxng(deps: Deps, f: typeof fetch, query: string, kind: Kind, signal?: AbortSignal): Promise<Hit[]> {
  const url = new URL("/search", deps.searxngUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  if (kind === "images") url.searchParams.set("categories", "images");
  const res = await f(url, { signal: timeout(signal) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { results?: SearxResult[] };
  return (data.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title || r.url!,
      url: r.url!,
      snippet: r.content?.trim() || undefined,
      image: kind === "images" ? r.thumbnail_src || r.img_src : r.thumbnail || r.img_src,
    }))
    .filter((h) => kind === "web" || h.image);
}

async function brave(deps: Deps, f: typeof fetch, query: string, kind: Kind, count: number, signal?: AbortSignal): Promise<Hit[]> {
  const url = new URL(`https://api.search.brave.com/res/v1/${kind === "images" ? "images" : "web"}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  const res = await f(url, { signal: timeout(signal), headers: { Accept: "application/json", "X-Subscription-Token": deps.braveApiKey! } });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: BraveResult[] }; results?: BraveResult[] };
  return ((kind === "images" ? data.results : data.web?.results) ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: r.title || r.url!, url: r.url!, snippet: r.description?.trim() || undefined, image: r.thumbnail?.src }))
    .filter((h) => kind === "web" || h.image);
}

async function search(deps: Deps, query: string, kind: Kind, count: number, signal?: AbortSignal): Promise<Hit[]> {
  const f = deps.fetch ?? fetch;
  let hits: Hit[] = [];
  let error: unknown;
  try {
    hits = await searxng(deps, f, query, kind, signal);
  } catch (err) {
    error = err;
  }
  if (!hits.length && deps.braveApiKey) return brave(deps, f, query, kind, count, signal);
  if (!hits.length && error) throw error;
  return hits;
}

function format(hits: Hit[], kind: Kind): string {
  return hits
    .map((h, i) => {
      const snippet = kind === "web" && h.snippet ? `\n   ${h.snippet}` : "";
      return `${i + 1}. ${h.title} — ${h.url}${snippet}${h.image ? `\n   image: ${h.image}` : ""}`;
    })
    .join("\n");
}

function searchTool(deps: Deps, kind: Kind, meta: { name: string; label: string; description: string; defaultCount: number }) {
  return defineTool({
    name: meta.name,
    label: meta.label,
    description: meta.description,
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      count: Type.Optional(Type.Number({ description: `results to return, default ${meta.defaultCount}, max 15` })),
    }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const count = Math.min(Math.max(Math.floor(params.count ?? meta.defaultCount), 1), 15);
      try {
        const hits = (await search(deps, params.query, kind, count, signal)).slice(0, count);
        if (!hits.length) return ok(`no results for "${params.query}"`);
        return ok(format(hits, kind), { results: hits });
      } catch (err) {
        return fail(`search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}

export const webSearchTool = (deps: Deps) =>
  searchTool(deps, "web", {
    name: "web_search",
    label: "Web search",
    description: "Search the web. Returns titles, URLs, snippets, and an image when the result has one. Use fetch_page or browse to read a result.",
    defaultCount: 8,
  });

const MAX_BATCH = 10;
const PER_NAME = 2;

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function queryList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    return [v];
  }
  return [];
}

export function imageSearchTool(deps: Deps) {
  const one = searchTool(deps, "images", { name: "image_search", label: "", description: "", defaultCount: 6 });
  return defineTool({
    name: "image_search",
    label: "Image search",
    description:
      "Find pictures: album and playlist covers, places, hotels, landmarks, dishes, people, or a product when its store page had none. Pass every name you need in queries (up to 10) in one call, e.g. [\"Rumours Fleetwood Mac album cover\", \"Hotel California Eagles album cover\"]; or one query for several results. Returns each image URL with the page it came from. Use those image URLs in show_ui cards.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "one search, for several pictures of one thing" })),
      queries: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()], { description: "one search per name, up to 10; returns the top pictures for each" })),
      count: Type.Optional(Type.Number({ description: "results for a single query, default 6, max 15" })),
    }),
    async execute(id, params, signal): Promise<ToolResult> {
      const names = queryList(params.queries).map((q) => q.trim()).filter(Boolean).slice(0, MAX_BATCH);
      if (!names.length) {
        if (!params.query) return fail("pass query or queries");
        return one.execute(id, { query: params.query, count: params.count }, signal, undefined, {} as never) as Promise<ToolResult>;
      }
      const sections = await mapLimit(names, 3, async (q) => {
        try {
          const hits = (await search(deps, q, "images", PER_NAME, signal)).slice(0, PER_NAME);
          return `${q}:\n${hits.length ? format(hits, "images") : "no pictures found"}`;
        } catch (err) {
          return `${q}:\nsearch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      });
      return ok(sections.join("\n\n"));
    },
  });
}
