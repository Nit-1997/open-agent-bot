import { describe, expect, it } from "vitest";
import { createArtifactTool, leadsWithPicture } from "../../src/tools/createArtifact.js";
import { musicListsToCards, showUiTool } from "../../src/tools/showWidget.js";

const run = (tool: { execute: unknown }, params: unknown) =>
  (tool.execute as (...a: unknown[]) => Promise<{ content: { text: string }[]; details: Record<string, unknown>; isError?: boolean }>)(
    "c",
    params,
    undefined,
    undefined,
    {},
  );

describe("music lists become picture cards", () => {
  it("turns a list of Spotify playlists into square cards with a source", () => {
    const [b] = musicListsToCards([
      {
        type: "list",
        items: [
          { title: "Diwali Party", subtitle: "73 songs", url: "https://open.spotify.com/playlist/1" },
          { title: "Bollywood Diwali Party", url: "https://open.spotify.com/playlist/2" },
        ],
      },
    ]) as { type: string; shape: string; items: { source?: string; subtitle?: string }[] }[];
    expect(b.type).toBe("cards");
    expect(b.shape).toBe("square");
    expect(b.items[0]).toMatchObject({ source: "Spotify", subtitle: "73 songs" });
  });

  it("leaves ordinary lists alone", () => {
    const blocks = [{ type: "list", items: [{ title: "Book flights" }, { title: "Pack sunscreen" }] }];
    expect(musicListsToCards(blocks)).toEqual(blocks);
  });

  it("fills cover art for the converted cards", async () => {
    const tool = showUiTool({ findImage: async (name) => `https://img.example/${encodeURIComponent(name)}.jpg`, isSourced: () => false });
    const res = await run(tool, {
      title: "Diwali playlists",
      blocks: [
        {
          type: "list",
          items: [{ title: "Diwali Party", url: "https://open.spotify.com/playlist/1" }, { title: "Bollywood Hits playlist" }],
        },
      ],
    });
    const widget = res.details.widget as { blocks: { type: string; items: { image?: string }[] }[] };
    expect(widget.blocks[0].type).toBe("cards");
    expect(widget.blocks[0].items.every((i) => i.image?.startsWith("https://img.example/"))).toBe(true);
  });
});

describe("reports lead with a picture", () => {
  const store = { save: async (_t: string, html: string) => ({ id: "a1", html }) };
  const images = { isSourced: () => true, loads: async () => true };
  const pic = '<img src="https://img.example/miata.jpg" alt="Miata RF">';
  const filler = `<p>${"x".repeat(7000)}</p>`;

  it("knows when a picture is near the top", () => {
    expect(leadsWithPicture(`<body><h1>Miata</h1>${pic}<p>text</p></body>`)).toBe(true);
    expect(leadsWithPicture("<body><h1>Miata</h1><p>no pictures</p></body>")).toBe(false);
  });

  it("copies the first picture up as the hero when a product report has pictures lower down", async () => {
    let saved = "";
    const tool = createArtifactTool(
      {
        save: async (_t: string, html: string) => {
          saved = html;
          return { id: "a1" };
        },
      } as never,
      images,
    );
    const res = await run(tool, {
      title: "Miata",
      html: `<header class="hero"><h1>Miata</h1></header>${filler}<article class="option">${pic}</article>`,
    });
    expect(res.isError).toBeUndefined();
    expect(saved.indexOf("miata.jpg")).toBeLessThan(saved.indexOf("xxxx"));
  });

  it("saves an educational report without pictures as written, with no error", async () => {
    const res = await run(createArtifactTool(store as never, images), { title: "Jev", html: "<h1>Jev</h1><p>Verdict</p>" });
    expect(res.isError).toBeUndefined();
    expect(res.details.artifactId).toBe("a1");
  });
});
