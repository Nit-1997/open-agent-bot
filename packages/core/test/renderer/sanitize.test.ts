import { describe, expect, it } from "vitest";
import { stripForRender } from "../../src/renderer/sanitize.js";

describe("stripForRender", () => {
  it("removes resource hints, speculation rules and meta refresh from a full document", () => {
    const html = `<!doctype html><html><head>
<link rel="prefetch" href="http://a/1"><link rel="PreRender" href="http://a/2"><link rel="preconnect" href="http://a">
<link rel="dns-prefetch" href="//a"><link rel="modulepreload" href="http://a/m.js"><link rel="stylesheet prefetch" href="http://a/3">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<meta http-equiv="Refresh" content="0;url=http://a/r"><meta charset="utf-8">
<script type="speculationrules">{"prefetch":[{"source":"list","urls":["http://a/s"]}]}</script>
<script type="SpeculationRules">{}</script><script>window.x = 1</script>
</head><body><svg><link rel="prefetch" href="http://a/4"/></svg><p>Hi</p></body></html>`;
    const out = stripForRender(html);
    expect(out).not.toMatch(/prefetch|prerender|preconnect|modulepreload|speculationrules|refresh/i);
    expect(out).toContain("fonts.googleapis.com");
    expect(out).toContain('charset="utf-8"');
    expect(out).toContain("window.x = 1");
    expect(out).toContain("<p>Hi</p>");
  });

  it("keeps a fragment's content", () => {
    const out = stripForRender(`<link rel=prefetch href="http://a/1"><h1>Title</h1>`);
    expect(out).toContain("<h1>Title</h1>");
    expect(out).not.toContain("prefetch");
  });

  it("leaves a document without hints unchanged", () => {
    const html = "<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>";
    expect(stripForRender(html)).toBe(html);
  });
});
