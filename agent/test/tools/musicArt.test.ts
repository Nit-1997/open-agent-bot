import { describe, expect, it } from "vitest";
import { confidentAlbum, coverQueries, musicCover, spotifyItemUrl } from "../../src/tools/musicArt.js";
import { showUiTool } from "../../src/tools/showWidget.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function fakeFetch(calls: string[]) {
  return (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://open.spotify.com/oembed")) return json({ thumbnail_url: "https://image-cdn.scdn.co/diwali.jpg" });
    if (url.startsWith("https://itunes.apple.com/search")) {
      return json({
        results: [
          { collectionName: "Thinking Thunderz Live", artistName: "Random Band", artworkUrl100: "https://is1.mzstatic.com/random/100x100bb.jpg" },
          { collectionName: "Bollywood Diwali Hits", artistName: "Various Artists", artworkUrl100: "https://is1.mzstatic.com/diwali/100x100bb.jpg" },
        ],
      });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

describe("music cover art", () => {
  it("normalises Spotify playlist links and ignores other sites", () => {
    expect(spotifyItemUrl("https://open.spotify.com/intl-en/playlist/37i9dQ?si=x")).toBe("https://open.spotify.com/playlist/37i9dQ");
    expect(spotifyItemUrl("https://example.com/playlist/1")).toBeUndefined();
  });

  it("uses Spotify's official cover when the card links to a playlist", async () => {
    const calls: string[] = [];
    const cover = await musicCover({ country: "US", fetch: fakeFetch(calls) })({ title: "Diwali Party", url: "https://open.spotify.com/playlist/37i9dQ" });
    expect(cover).toBe("https://image-cdn.scdn.co/diwali.jpg");
    expect(calls[0]).toContain("oembed?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F37i9dQ");
  });

  it("falls back to a confidently matched Apple Music album", async () => {
    const cover = await musicCover({ country: "US", fetch: fakeFetch([]) })({ title: "Bollywood Diwali Hits playlist" });
    expect(cover).toBe("https://is1.mzstatic.com/diwali/600x600bb.jpg");
  });

  it("searches with a cleaned name, then just the core words", () => {
    expect(coverQueries("Happy Diwali! Bollywood Party Songs (Spotify editorial)")).toEqual(["Happy Diwali Bollywood Party Songs", "happy diwali bollywood", "happy diwali", "happy"]);
  });

  it("gives no picture rather than a weak match", () => {
    expect(confidentAlbum([{ collectionName: "Thinking Thunderz Live", artistName: "Random Band", artworkUrl100: "x" }], "Happy Diwali Bollywood Party Songs")).toBeUndefined();
  });

  it("show_ui fills music cards from cover art, never the general image search", async () => {
    const searched: string[] = [];
    const tool = showUiTool({
      findImage: async (name) => {
        searched.push(name);
        return "https://img.example/logo.jpg";
      },
      findMusicArt: musicCover({ country: "US", fetch: fakeFetch([]) }),
      isSourced: () => false,
    });
    const res = await (tool.execute as (...a: unknown[]) => Promise<{ details: { widget: { blocks: { items: { image?: string }[] }[] } } }>)("c", {
      title: "Diwali playlists",
      blocks: [{ type: "list", items: [{ title: "Diwali Party", url: "https://open.spotify.com/playlist/37i9dQ" }, { title: "Happy Diwali Bollywood Party Songs playlist" }] }],
    }, undefined, undefined, {});
    const [spotify, named] = res.details.widget.blocks[0].items;
    expect(spotify.image).toBe("https://image-cdn.scdn.co/diwali.jpg");
    expect(named.image).toBe("https://is1.mzstatic.com/diwali/600x600bb.jpg");
    expect(searched).toEqual([]);
  });

  it("prefers the real cover over a picture the agent picked for a music card", async () => {
    const tool = showUiTool({ findImage: async () => undefined, findMusicArt: musicCover({ country: "US", fetch: fakeFetch([]) }), isSourced: () => true });
    const res = await (tool.execute as (...a: unknown[]) => Promise<{ details: { widget: { blocks: { items: { image?: string }[] }[] } } }>)("c", {
      title: "Diwali",
      blocks: [{ type: "cards", items: [{ title: "Diwali Party", source: "Spotify", url: "https://open.spotify.com/playlist/37i9dQ", image: "https://encrypted-tbn0.gstatic.com/images?q=logo" }] }],
    }, undefined, undefined, {});
    expect(res.details.widget.blocks[0].items[0].image).toBe("https://image-cdn.scdn.co/diwali.jpg");
  });
});
