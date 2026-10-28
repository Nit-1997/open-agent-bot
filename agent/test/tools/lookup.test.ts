import { describe, expect, it } from "vitest";
import { musicTool, wikipediaTool } from "../../src/tools/lookup.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

const run = (tool: { execute: (...a: never[]) => Promise<unknown> }, params: object) =>
  tool.execute(...(["c", params, undefined, undefined, {}] as never[])) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

const album = {
  collectionName: "Led Zeppelin IV (Remastered)",
  artistName: "Led Zeppelin",
  artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/5c/dj.jpg/100x100bb.jpg",
  collectionViewUrl: "https://music.apple.com/us/album/led-zeppelin-iv-remastered/580708175?uo=4",
  releaseDate: "1971-11-08T08:00:00Z",
  primaryGenreName: "Rock",
};

describe("music", () => {
  it("finds each album with large artwork and an Apple Music link", async () => {
    const f = fakeFetch([[/itunes\.apple\.com\/search/, () => json({ results: [album] })]]);
    const r = await run(musicTool({ country: "US", fetch: f }), { queries: ["Led Zeppelin IV"] });
    expect(r.content[0].text).toBe(
      "Led Zeppelin IV:\nLed Zeppelin IV (Remastered) — Led Zeppelin · 1971 · Rock\n   link: https://music.apple.com/us/album/led-zeppelin-iv-remastered/580708175?uo=4\n   image: https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/5c/dj.jpg/600x600bb.jpg",
    );
    const u = new URL(f.calls[0]);
    expect(u.searchParams.get("term")).toBe("Led Zeppelin IV");
    expect(u.searchParams.get("entity")).toBe("album");
    expect(u.searchParams.get("country")).toBe("US");
  });

  it("picks the result that best matches the title and artist, not just the first", async () => {
    const cover = { ...album, collectionName: "Dark Side of the Moon (Country Cover) - Single", artistName: "Nashville Tribute" };
    const real = { ...album, collectionName: "The Dark Side of the Moon", artistName: "Pink Floyd" };
    const f = fakeFetch([[/itunes/, () => json({ results: [cover, real] })]]);
    const r = await run(musicTool({ country: "US", fetch: f }), { queries: ["Pink Floyd The Dark Side of the Moon"] });
    expect(r.content[0].text).toContain("The Dark Side of the Moon — Pink Floyd");
    expect(new URL(f.calls[0]).searchParams.get("limit")).toBe("5");
  });

  it("looks up songs when asked", async () => {
    const song = { ...album, trackName: "Stairway to Heaven", trackViewUrl: "https://music.apple.com/us/album/stairway/580708175?i=1" };
    const f = fakeFetch([[/itunes/, () => json({ results: [song] })]]);
    const r = await run(musicTool({ country: "US", fetch: f }), { queries: ["stairway to heaven"], kind: "song" });
    expect(r.content[0].text).toContain("Stairway to Heaven — Led Zeppelin · Led Zeppelin IV (Remastered) · 1971");
    expect(r.content[0].text).toContain("link: https://music.apple.com/us/album/stairway/580708175?i=1");
    expect(new URL(f.calls[0]).searchParams.get("entity")).toBe("song");
  });

  it("says when nothing matched", async () => {
    const f = fakeFetch([[/itunes/, () => json({ results: [] })]]);
    expect((await run(musicTool({ country: "US", fetch: f }), { queries: ["zzz"] })).content[0].text).toBe("zzz:\nnot found");
  });
});

describe("wikipedia", () => {
  it("returns a summary, picture, and link for each name", async () => {
    const page = {
      title: "Kinkaku-ji",
      description: "Zen Buddhist temple in Kyoto, Japan",
      extract: "Kinkaku-ji is a Zen Buddhist temple in Kyoto, Japan and a tourist attraction.",
      thumbnail: { source: "https://thumb.wikimedia.org/k.jpg/640px-k.jpg" },
      fullurl: "https://en.wikipedia.org/wiki/Kinkaku-ji",
    };
    const f = fakeFetch([[/en\.wikipedia\.org\/w\/api\.php/, () => json({ query: { pages: { "1": page } } })]]);
    const r = await run(wikipediaTool({ fetch: f }), { queries: ["Kinkaku-ji"] });
    expect(r.content[0].text).toBe(
      "Kinkaku-ji — Zen Buddhist temple in Kyoto, Japan\n   Kinkaku-ji is a Zen Buddhist temple in Kyoto, Japan and a tourist attraction.\n   link: https://en.wikipedia.org/wiki/Kinkaku-ji\n   image: https://thumb.wikimedia.org/k.jpg/640px-k.jpg",
    );
    expect(new URL(f.calls[0]).searchParams.get("gsrsearch")).toBe("Kinkaku-ji");
  });

  it("says when there is no article", async () => {
    const f = fakeFetch([[/wikipedia/, () => json({ batchcomplete: "" })]]);
    expect((await run(wikipediaTool({ fetch: f }), { queries: ["qqqq"] })).content[0].text).toBe("qqqq: no article found");
  });
});
