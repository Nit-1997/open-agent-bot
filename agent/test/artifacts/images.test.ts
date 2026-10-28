import { describe, expect, it } from "vitest";
import { imageLoads, vetImages } from "../../src/artifacts/images.js";
import { fakeFetch } from "../fixtures/fakeFetch.js";

const sourced = new Set(["https://img.test/miata.jpg", "https://img.test/rf.jpg", "https://img.test/broken.jpg"]);
const check = { isSourced: (u: string) => sourced.has(u), loads: async (u: string) => !u.includes("broken") };

describe("vetImages", () => {
  it("keeps sourced pictures that load and removes the rest with their figure", async () => {
    const html = `<header class="hero"><h1>Miata</h1><img src="https://img.test/miata.jpg" alt="Miata"></header>
      <figure><img src="https://made.up/guess.jpg" alt="x"><figcaption>guessed</figcaption></figure>
      <div class="options"><article class="option"><img src="https://img.test/broken.jpg" alt="b"><div class="body"><h3>BRZ</h3></div></article></div>
      <figure><img src="https://img.test/rf.jpg" alt="RF"><figcaption>RF</figcaption></figure>
      <img src="data:image/svg+xml;utf8,<svg/>" alt="chart">`;
    const r = await vetImages(html, check);
    expect(r).toMatchObject({ kept: 3, dropped: 2 });
    expect(r.html).toContain("https://img.test/miata.jpg");
    expect(r.html).toContain("https://img.test/rf.jpg");
    expect(r.html).not.toContain("guessed");
    expect(r.html).not.toContain("broken.jpg");
    expect(r.html).toContain("<h3>BRZ</h3>");
  });

  it("drops tiny Google thumbnails even when a tool returned them", async () => {
    const thumb = "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc";
    const r = await vetImages(`<h1>Diwali</h1><img src="${thumb}" alt="logo">`, { isSourced: () => true, loads: async () => true });
    expect(r).toMatchObject({ kept: 0, dropped: 1 });
    expect(r.html).not.toContain("gstatic");
  });

  it("keeps a full document a full document", async () => {
    const r = await vetImages("<!doctype html><html><head><title>T</title></head><body><p>hi</p></body></html>", check);
    expect(r.html).toMatch(/<html>.*<title>T<\/title>.*<p>hi<\/p>/s);
  });
});

describe("imageLoads", () => {
  it("accepts only reachable public image responses", async () => {
    const f = fakeFetch([
      [/ok\.jpg/, () => new Response("x", { headers: { "content-type": "image/jpeg" } })],
      [/page\.jpg/, () => new Response("<html>", { headers: { "content-type": "text/html" } })],
    ]);
    const loads = imageLoads(f);
    expect(await loads("https://img.test/ok.jpg")).toBe(true);
    expect(await loads("https://img.test/page.jpg")).toBe(false);
    expect(await loads("https://img.test/missing.jpg")).toBe(false);
    expect(await loads("http://127.0.0.1/x.jpg")).toBe(false);
  });
});
