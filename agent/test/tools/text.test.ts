import { describe, expect, it } from "vitest";
import { htmlToText, MAX_PAGE_CHARS, truncate } from "../../src/tools/text.js";

describe("truncate", () => {
  it("truncate adds marker only when cut", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdefgh", 5)).toBe("abcde\n[truncated]");
    expect(MAX_PAGE_CHARS).toBe(12000);
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles and collapses whitespace", () => {
    const t = htmlToText("<html><body><script>var x=1</script><style>p{}</style><nav>Menu</nav><p>Hello   \n\n  world</p></body></html>");
    expect(t).toContain("Hello world");
    expect(t).not.toContain("var x");
    expect(t).not.toContain("p{}");
  });
});
