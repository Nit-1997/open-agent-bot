import { describe, expect, it } from "vitest";
import { fetchPageTool } from "../../src/tools/fetchPage.js";
import { fakeFetch, html } from "../fixtures/fakeFetch.js";

const text = (r: { content: Array<{ text?: string }> }) => r.content[0].text ?? "";
const publicDns = async () => ["93.184.216.34"];
const call = (f: typeof fetch, url: string, lookup = publicDns) => fetchPageTool({ fetch: f, lookup }).execute("c", { url }, undefined, undefined, {} as never);

describe("fetch_page", () => {
  it("fetch_page truncates and rejects binary", async () => {
    const f = fakeFetch([
      [/big/, () => html(`<p>${"word ".repeat(10000)}</p>`)],
      [/doc\.pdf/, () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })],
    ]);
    const big = await call(f, "https://example.com/big");
    expect(text(big)).toMatch(/\[truncated\]$/);
    expect(text(big).length).toBeLessThan(12200);
    const pdf = await call(f, "https://example.com/doc.pdf");
    expect(pdf.isError).toBe(true);
    expect(text(pdf)).toBe("unsupported content-type application/pdf");
  });

  it("fetch_page reports 403 as possible blocking", async () => {
    const f = fakeFetch([[/shop/, () => html("denied", 403)]]);
    const r = await call(f, "https://shop.example.com/item");
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("HTTP 403 from shop.example.com — the site may be blocking automated access");
  });

  it("returns readable text for html", async () => {
    const f = fakeFetch([[/ok/, () => html("<article><h1>Title</h1><p>Body text here.</p></article>")]]);
    const r = await call(f, "https://example.com/ok");
    expect(text(r)).toContain("Body text here.");
  });

  it("lists the page's product images after the text", async () => {
    const f = fakeFetch([[/shop/, () => html('<article><h1>Boots</h1><p>Turf boots for every budget.</p><p>Tiempo Academy TF $95</p><img src="/b.jpg" alt="Tiempo Academy TF"></article>')]]);
    const t = text(await call(f, "https://example.com/shop"));
    expect(t).toContain("images:\n- Tiempo Academy TF — https://example.com/b.jpg");
  });

  it("rejects non-http urls", async () => {
    const r = await call(fakeFetch([]), "file:///etc/passwd");
    expect(r.isError).toBe(true);
  });
});

describe("fetch_page network guard", () => {
  it("refuses internal hosts", async () => {
    const f = fakeFetch([[/.*/, () => html("secret")]]);
    for (const url of ["http://llm:4000/v1/models", "http://127.0.0.1:8000/", "http://169.254.169.254/"]) {
      const r = await call(f, url);
      expect(r.isError, url).toBe(true);
    }
    expect(f.calls).toEqual([]);
  });

  it("refuses a redirect to an internal host", async () => {
    const f = fakeFetch([
      [/example\.com/, () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })],
      [/169\.254/, () => html("secret")],
    ]);
    const r = await call(f, "https://example.com/go");
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("refusing internal or private address");
    expect(f.calls).toEqual(["https://example.com/go"]);
  });

  it("refuses a public name that resolves to a private address", async () => {
    const f = fakeFetch([[/.*/, () => html("secret")]]);
    const r = await call(f, "https://rebind.example.com/", async () => ["10.0.0.5"]);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("resolves to a private address");
    expect(f.calls).toEqual([]);
  });

  it("follows public redirects and reports the final url", async () => {
    const f = fakeFetch([
      [/old/, () => new Response(null, { status: 301, headers: { location: "/new" } })],
      [/new/, () => html("<article><p>Moved here.</p></article>")],
    ]);
    const t = text(await call(f, "https://example.com/old"));
    expect(t).toMatch(/^url: https:\/\/example\.com\/new/);
    expect(t).toContain("Moved here.");
  });
});

describe("fetch_page structured data", () => {
  const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Product", name: "Kettle", offers: { "@type": "Offer", price: "39.90", priceCurrency: "EUR", availability: "https://schema.org/InStock" } }] });
  const f = fakeFetch([[/kettle/, () => html(`<script type="application/ld+json">${ld}</script><p>A kettle.</p>`)]]);
  const run = (structured: boolean) => fetchPageTool({ fetch: f, lookup: publicDns, structured }).execute("c", { url: "https://shop.example.com/kettle" }, undefined, undefined, {} as never);

  it("appends compact structured lines when on", async () => {
    expect(text(await run(true))).toMatch(/\n\nstructured:\n- product: Kettle — EUR 39.9, InStock$/);
  });

  it("leaves the result unchanged when off", async () => {
    expect(text(await run(false))).not.toContain("structured:");
  });
});
