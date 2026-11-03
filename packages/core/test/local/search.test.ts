import { describe, expect, it } from "vitest";
import { caseFold, snippetOf } from "../../src/local/store/search.js";

const at = (content: string, query: string) => {
  const { snippet, snippetStart } = snippetOf(content, query);
  return { snippet, snippetStart, position: Array.from(content).indexOf(Array.from(query)[0]!) + 1 };
};

describe("snippetOf", () => {
  it("starts at the match when it is near the start", () => {
    expect(at("hello lamplighter", "lamp")).toMatchObject({ snippetStart: 1 });
  });

  it("counts code points, not UTF-16 units, before the match", () => {
    const content = `${"😀".repeat(100)}needle`;
    const { snippetStart, snippet } = snippetOf(content, "needle");
    expect(snippetStart).toBe(41);
    expect(snippet.includes("needle")).toBe(true);
  });

  it("keeps the start on the original text when lower-casing changes a character's length", () => {
    const content = `${"İ".repeat(100)}needle`;
    const { snippet, snippetStart } = snippetOf(content, "needle");
    expect(snippetStart).toBe(101 - 60);
    expect(Array.from(snippet).slice(60, 66).join("")).toBe("needle");
  });

  it("finds a query that itself folds to a longer string", () => {
    const content = `${"x".repeat(80)}İstanbul`;
    const { snippet, snippetStart } = snippetOf(content, "İSTANBUL");
    expect(snippetStart).toBe(81 - 60);
    expect(snippet.slice(60)).toMatch(/^İstanbul/);
  });

  it("folds each code point on its own, so a final sigma matches a mid-word sigma", () => {
    expect(caseFold("ΟΔΟΣ")).toBe("οδοσ");
    expect(snippetOf(`${"x".repeat(70)}ΟΔΟΣ`, "οδοσ").snippetStart).toBe(71 - 60);
  });
});
