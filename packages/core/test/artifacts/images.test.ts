import { describe, expect, it } from "vitest";
import { inlineImage, MAX_IMAGE_BYTES, MAX_INLINE_BYTES, vetImages } from "../../src/artifacts/images.js";
import { fakeFetch } from "../fixtures/fakeFetch.js";

const sourced = new Set(["https://img.test/miata.jpg", "https://img.test/rf.jpg", "https://img.test/broken.jpg"]);
const data = (name: string, bytes = 10) => ({ dataUrl: `data:image/jpeg;base64,${Buffer.from(name).toString("base64")}`, bytes });
const check = { isSourced: (u: string) => sourced.has(u), inline: async (u: string) => (u.includes("broken") ? undefined : data(u)) };

describe("vetImages", () => {
  it("inlines sourced pictures that load and removes the rest with their figure", async () => {
    const html = `<header class="hero"><h1>Miata</h1><img src="https://img.test/miata.jpg" alt="Miata"></header>
      <figure><img src="https://made.up/guess.jpg" alt="x"><figcaption>guessed</figcaption></figure>
      <div class="options"><article class="option"><img src="https://img.test/broken.jpg" alt="b"><div class="body"><h3>BRZ</h3></div></article></div>
      <figure><img src="https://img.test/rf.jpg" srcset="https://img.test/rf-2x.jpg 2x" alt="RF"><figcaption>RF</figcaption></figure>
      <img src="data:image/svg+xml;utf8,<svg/>" alt="chart">`;
    const r = await vetImages(html, check);
    expect(r).toMatchObject({ kept: 3, dropped: 2 });
    expect(r.html).toContain(data("https://img.test/miata.jpg").dataUrl);
    expect(r.html).toContain(data("https://img.test/rf.jpg").dataUrl);
    expect(r.html).not.toMatch(/src="https?:/);
    expect(r.html).not.toContain("srcset");
    expect(r.html).not.toContain("guessed");
    expect(r.html).toContain("<h3>BRZ</h3>");
  });

  it("stops inlining once the report's picture budget is spent", async () => {
    const big = { isSourced: () => true, inline: async (u: string) => data(u, MAX_INLINE_BYTES / 2 + 1) };
    const r = await vetImages('<img src="https://a.test/1.jpg"><img src="https://a.test/2.jpg">', big);
    expect(r).toMatchObject({ kept: 1, dropped: 1 });
  });

  it("drops tiny Google thumbnails even when a tool returned them", async () => {
    const thumb = "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc";
    const r = await vetImages(`<h1>Diwali</h1><img src="${thumb}" alt="logo">`, { isSourced: () => true, inline: async () => data("x") });
    expect(r).toMatchObject({ kept: 0, dropped: 1 });
    expect(r.html).not.toContain("gstatic");
  });

  it("keeps a full document a full document", async () => {
    const r = await vetImages("<!doctype html><html><head><title>T</title></head><body><p>hi</p></body></html>", check);
    expect(r.html).toMatch(/<html>.*<title>T<\/title>.*<p>hi<\/p>/s);
  });
});

describe("inlineImage", () => {
  it("turns reachable public images into data URLs and refuses pages, oversize files and private hosts", async () => {
    const f = fakeFetch([
      [/ok\.jpg/, () => new Response("jpeg", { headers: { "content-type": "image/jpeg" } })],
      [/page\.jpg/, () => new Response("<html>", { headers: { "content-type": "text/html" } })],
      [/huge\.png/, () => new Response(Buffer.alloc(MAX_IMAGE_BYTES + 1), { headers: { "content-type": "image/png" } })],
    ]);
    const inline = inlineImage(f);
    expect(await inline("https://img.test/ok.jpg")).toEqual({ dataUrl: "data:image/jpeg;base64,anBlZw==", bytes: 4 });
    expect(await inline("https://img.test/page.jpg")).toBeUndefined();
    expect(await inline("https://img.test/huge.png")).toBeUndefined();
    expect(await inline("https://img.test/missing.jpg")).toBeUndefined();
    expect(await inline("http://127.0.0.1/x.jpg")).toBeUndefined();
  });
});
