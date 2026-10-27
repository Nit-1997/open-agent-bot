import { describe, expect, it } from "vitest";
import { fetchPageTool } from "../../src/tools/fetchPage.js";
import { fakeFetch, html } from "../fixtures/fakeFetch.js";

const text = (r: { content: Array<{ text?: string }> }) => r.content[0].text ?? "";
const call = (f: typeof fetch, url: string) => fetchPageTool({ fetch: f }).execute("c", { url }, undefined, undefined, {} as never);

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

  it("rejects non-http urls", async () => {
    const r = await call(fakeFetch([]), "file:///etc/passwd");
    expect(r.isError).toBe(true);
  });
});
