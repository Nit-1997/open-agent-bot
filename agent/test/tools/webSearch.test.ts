import { describe, expect, it } from "vitest";
import { imageSearchTool, webSearchTool } from "../../src/tools/webSearch.js";
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
    const f = fakeFetch([
      [/search/, () => json({ results: [{ title: "Boot", url: "https://s.com/b", content: "TF", thumbnail: "https://img.s.com/b.jpg" }] })],
    ]);
    const r = await webSearchTool({ searxngUrl: "http://search.local", fetch: f }).execute(
      "c",
      { query: "boot" },
      undefined,
      undefined,
      {} as never,
    );
    expect((r.content[0] as { text: string }).text).toBe("1. Boot — https://s.com/b\n   TF\n   image: https://img.s.com/b.jpg");
  });

  it("defaults to 8 results", async () => {
    const f = fakeFetch([[/search/, () => json({ results })]]);
    const r = await webSearchTool({ searxngUrl: "http://search.local", fetch: f }).execute(
      "c",
      { query: "x" },
      undefined,
      undefined,
      {} as never,
    );
    const t = (r.content[0] as { text: string }).text;
    expect(t).toContain("8. T8");
    expect(t).not.toContain("9. T9");
  });

  it("reports no results", async () => {
    const f = fakeFetch([[/search/, () => json({ results: [] })]]);
    const r = await webSearchTool({ searxngUrl: "http://search.local", fetch: f }).execute(
      "c",
      { query: "x" },
      undefined,
      undefined,
      {} as never,
    );
    expect((r.content[0] as { text: string }).text).toBe('no results for "x"');
  });
});

const run = (tool: { execute: (...a: never[]) => Promise<unknown> }, params: object) =>
  tool.execute(...(["c", params, undefined, undefined, {}] as never[])) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function recordingFetch(routes: Array<[RegExp, unknown]>) {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const hit = routes.find(([re]) => re.test(url.href));
    return hit ? json(hit[1]) : new Response("nope", { status: 404 });
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}

describe("search fallback", () => {
  const empty: [RegExp, unknown] = [/search\.local/, { results: [] }];

  it("uses the Brave Search API when SearXNG finds nothing and a key is set", async () => {
    const f = recordingFetch([
      empty,
      [
        /api\.search\.brave\.com\/res\/v1\/web/,
        {
          web: {
            results: [
              { title: "Hotel Lisboa", url: "https://h.com/l", description: "Old town", thumbnail: { src: "https://imgs.b.com/l.jpg" } },
            ],
          },
        },
      ],
    ]);
    const r = await run(webSearchTool({ searxngUrl: "http://search.local", braveApiKey: "k1", fetch: f }), { query: "lisbon hotels" });
    expect(r.content[0].text).toBe("1. Hotel Lisboa — https://h.com/l\n   Old town\n   image: https://imgs.b.com/l.jpg");
    expect(f.calls[1].headers["X-Subscription-Token"]).toBe("k1");
    expect(f.calls[1].url.searchParams.get("q")).toBe("lisbon hotels");
  });

  it("never calls Brave without a key", async () => {
    const f = recordingFetch([empty]);
    const r = await run(webSearchTool({ searxngUrl: "http://search.local", fetch: f }), { query: "x" });
    expect(r.content[0].text).toBe('no results for "x"');
    expect(f.calls).toHaveLength(1);
  });
});

describe("image_search", () => {
  it("searches images and lists each picture with the page it came from", async () => {
    const f = recordingFetch([
      [
        /search\.local/,
        {
          results: [
            {
              title: "1989 (Taylor's Version)",
              url: "https://music.com/1989",
              img_src: "https://cdn.music.com/1989-full.jpg",
              thumbnail_src: "https://tse1.mm.bing.net/th/id/OIP.1989",
            },
            { title: "No picture", url: "https://x.com/n" },
          ],
        },
      ],
    ]);
    const r = await run(imageSearchTool({ searxngUrl: "http://search.local", fetch: f }), { query: "1989 album cover" });
    expect(r.content[0].text).toBe(
      "1. 1989 (Taylor's Version) — https://music.com/1989\n   image: https://tse1.mm.bing.net/th/id/OIP.1989",
    );
    expect(f.calls[0].url.searchParams.get("categories")).toBe("images");
  });

  it("looks up several names in one call, keeping the top pictures for each", async () => {
    const f = recordingFetch([
      [
        /search\.local/,
        {
          results: [
            { title: "Cover A", url: "https://a.com/1", thumbnail_src: "https://t.com/a1" },
            { title: "Cover A2", url: "https://a.com/2", thumbnail_src: "https://t.com/a2" },
            { title: "Cover A3", url: "https://a.com/3", thumbnail_src: "https://t.com/a3" },
          ],
        },
      ],
    ]);
    const r = await run(imageSearchTool({ searxngUrl: "http://search.local", fetch: f }), {
      queries: ["Rumours album cover", "Hotel California album cover"],
    });
    expect(r.content[0].text).toBe(
      "Rumours album cover:\n1. Cover A — https://a.com/1\n   image: https://t.com/a1\n2. Cover A2 — https://a.com/2\n   image: https://t.com/a2\n\n" +
        "Hotel California album cover:\n1. Cover A — https://a.com/1\n   image: https://t.com/a1\n2. Cover A2 — https://a.com/2\n   image: https://t.com/a2",
    );
    expect(f.calls.map((c) => c.url.searchParams.get("q"))).toEqual(["Rumours album cover", "Hotel California album cover"]);
  });

  it("caps a batch at 10 names", async () => {
    const f = recordingFetch([[/search\.local/, { results: [] }]]);
    await run(imageSearchTool({ searxngUrl: "http://search.local", fetch: f }), { queries: Array.from({ length: 14 }, (_, i) => `q${i}`) });
    expect(f.calls).toHaveLength(10);
  });

  it("falls back to Brave image search", async () => {
    const f = recordingFetch([
      [/search\.local/, { results: [] }],
      [
        /res\/v1\/images/,
        { results: [{ title: "Alfama", url: "https://p.com/alfama", thumbnail: { src: "https://imgs.b.com/alfama.jpg" } }] },
      ],
    ]);
    const r = await run(imageSearchTool({ searxngUrl: "http://search.local", braveApiKey: "k", fetch: f }), { query: "alfama lisbon" });
    expect(r.content[0].text).toBe("1. Alfama — https://p.com/alfama\n   image: https://imgs.b.com/alfama.jpg");
  });
});
