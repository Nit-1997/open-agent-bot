import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fail, ok, type ToolResult } from "./result.js";
import { mapLimit, queryList } from "./webSearch.js";

const MAX_BATCH = 10;
const UA = { "user-agent": "OpenAgent/0.1 (personal assistant prototype)" };
const timeout = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000));

const Queries = Type.Union([Type.Array(Type.String()), Type.String()], { description: "names to look up, up to 10, in one call" });

function names(v: unknown): string[] {
  return queryList(v).map((q) => q.trim()).filter(Boolean).slice(0, MAX_BATCH);
}

type ITunes = {
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  collectionViewUrl?: string;
  trackViewUrl?: string;
  releaseDate?: string;
  primaryGenreName?: string;
};

function describeMusic(r: ITunes, kind: "album" | "song"): string {
  const year = r.releaseDate?.slice(0, 4);
  const parts = kind === "song" ? [r.artistName, r.collectionName, year] : [r.artistName, year, r.primaryGenreName];
  const title = kind === "song" ? r.trackName : r.collectionName;
  const link = kind === "song" ? r.trackViewUrl : r.collectionViewUrl;
  const image = r.artworkUrl100?.replace(/\/\d+x\d+bb\./, "/600x600bb.");
  return `${title} — ${parts.filter(Boolean).join(" · ")}${link ? `\n   link: ${link}` : ""}${image ? `\n   image: ${image}` : ""}`;
}

const words = (s: string) => new Set(s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1));

function bestMatch(results: ITunes[], query: string, kind: "album" | "song"): ITunes | undefined {
  const want = words(query);
  const score = (r: ITunes) => {
    const have = words(`${kind === "song" ? r.trackName : r.collectionName} ${r.artistName}`);
    let hits = 0;
    for (const w of want) if (have.has(w)) hits++;
    return hits - (/\b(single|tribute|karaoke|cover)\b/i.test(`${r.collectionName} ${r.artistName}`) ? 2 : 0);
  };
  return results.reduce<ITunes | undefined>((best, r) => (!best || score(r) > score(best) ? r : best), undefined);
}

export function musicTool(deps: { country: string; fetch?: typeof fetch }) {
  const f = deps.fetch ?? fetch;
  return defineTool({
    name: "music",
    label: "Music",
    description:
      "Look up albums or songs: official cover art, artist, year, and an Apple Music link. Use it for playlists and album recommendations; pass every title in one call, e.g. [\"Rumours Fleetwood Mac\", \"Hotel California Eagles\"].",
    parameters: Type.Object({
      queries: Queries,
      kind: Type.Optional(Type.Enum(["album", "song"], { description: "default album" })),
    }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const list = names(params.queries);
      if (!list.length) return fail("pass queries");
      const kind = params.kind === "song" ? "song" : "album";
      const sections = await mapLimit(list, 4, async (q) => {
        const url = new URL("https://itunes.apple.com/search");
        url.searchParams.set("term", q);
        url.searchParams.set("entity", kind);
        url.searchParams.set("limit", "5");
        url.searchParams.set("country", deps.country);
        try {
          const res = await f(url, { signal: timeout(signal), headers: UA });
          if (!res.ok) return `${q}:\nlookup failed: HTTP ${res.status}`;
          const hit = bestMatch(((await res.json()) as { results?: ITunes[] }).results ?? [], q, kind);
          return `${q}:\n${hit ? describeMusic(hit, kind) : "not found"}`;
        } catch (err) {
          return `${q}:\nlookup failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      });
      return ok(sections.join("\n\n"));
    },
  });
}

type WikiPage = { title?: string; description?: string; extract?: string; thumbnail?: { source?: string }; fullurl?: string };

export function wikipediaTool(deps: { fetch?: typeof fetch } = {}) {
  const f = deps.fetch ?? fetch;
  return defineTool({
    name: "wikipedia",
    label: "Wikipedia",
    description:
      "Look up places, landmarks, people, events, or topics on Wikipedia: a short summary, the lead picture, and the article link. Pass every name in one call, e.g. [\"Kinkaku-ji\", \"Fushimi Inari-taisha\"]. Good for research overviews and travel sights.",
    parameters: Type.Object({ queries: Queries }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const list = names(params.queries);
      if (!list.length) return fail("pass queries");
      const sections = await mapLimit(list, 4, async (q) => {
        const url = new URL("https://en.wikipedia.org/w/api.php");
        for (const [k, v] of Object.entries({
          action: "query",
          format: "json",
          generator: "search",
          gsrsearch: q,
          gsrlimit: "1",
          prop: "pageimages|extracts|description|info",
          piprop: "thumbnail",
          pithumbsize: "640",
          exintro: "1",
          explaintext: "1",
          exsentences: "2",
          inprop: "url",
        })) {
          url.searchParams.set(k, v);
        }
        try {
          const res = await f(url, { signal: timeout(signal), headers: UA });
          if (!res.ok) return `${q}: lookup failed: HTTP ${res.status}`;
          const page = Object.values(((await res.json()) as { query?: { pages?: Record<string, WikiPage> } }).query?.pages ?? {})[0];
          if (!page?.title) return `${q}: no article found`;
          const extract = page.extract ? `\n   ${page.extract.replace(/\s+/g, " ").trim().slice(0, 300)}` : "";
          return `${page.title}${page.description ? ` — ${page.description}` : ""}${extract}${page.fullurl ? `\n   link: ${page.fullurl}` : ""}${page.thumbnail?.source ? `\n   image: ${page.thumbnail.source}` : ""}`;
        } catch (err) {
          return `${q}: lookup failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      });
      return ok(sections.join("\n\n"));
    },
  });
}
