import { describe, expect, it } from "vitest";
import { normalizeQuery } from "../../../shared/lists.js";
import { safeHttpUrl } from "../../../shared/workspace.js";

describe("normalizeQuery", () => {
  it("removes control and format characters, normalises and collapses whitespace", () => {
    expect(normalizeQuery("  ta\u0000co​   night ")).toBe("taco night");
    expect(normalizeQuery("ｔａｃｏ")).toBe("taco");
  });

  it("enforces 3 to 100 code points and a raw cap of 400", () => {
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery("ab")).toBeNull();
    expect(normalizeQuery(" a b ")).toBe("a b");
    expect(normalizeQuery("abc")).toBe("abc");
    expect(normalizeQuery("a".repeat(100))).toHaveLength(100);
    expect(normalizeQuery("a".repeat(101))).toBeNull();
    expect(normalizeQuery(`${" ".repeat(398)}abc`)).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
  });
});

describe("safeHttpUrl", () => {
  it("keeps http and https only", () => {
    expect(safeHttpUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(safeHttpUrl("http://a.test/")).toBe("http://a.test/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,x")).toBeUndefined();
    expect(safeHttpUrl("/relative")).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
  });
});
