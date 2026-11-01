import { describe, expect, it } from "vitest";
import { normalizeQuery } from "../../../shared/lists.js";
import { entityIdFromKey, entityKey, safeHttpUrl } from "../../../shared/workspace.js";

describe("normalizeQuery", () => {
  it("removes control and format characters, normalises and collapses whitespace", () => {
    expect(normalizeQuery("  ta\u0000co​   night ")).toBe("taco night");
    expect(normalizeQuery("ｔａｃｏ")).toBe("taco");
  });

  it("enforces 2 to 100 code points and a raw cap of 400", () => {
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery("ab")).toBe("ab");
    expect(normalizeQuery("a".repeat(100))).toHaveLength(100);
    expect(normalizeQuery("a".repeat(101))).toBeNull();
    expect(normalizeQuery(`${" ".repeat(399)}ab`)).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
  });
});

describe("entityKey", () => {
  it.each(["..", ".", "a/b", "50%", "x?y#z", "Zürich trip", "t1", "😀 party", "x".repeat(100)])("round-trips %j", (id) => {
    const key = entityKey(id);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(entityIdFromKey(key)).toBe(id);
  });

  it("rejects keys that aren't canonical, decode badly or decode to too much", () => {
    expect(entityKey("t1")).toBe("dDE");
    expect(entityIdFromKey("dDF")).toBeUndefined();
    expect(entityIdFromKey("t2")).toBeUndefined();
    expect(entityIdFromKey("_w")).toBeUndefined();
    expect(entityIdFromKey(entityKey("x".repeat(101)))).toBeUndefined();
    expect(entityIdFromKey("a")).toBeUndefined();
    expect(entityIdFromKey("ab/c")).toBeUndefined();
    expect(entityIdFromKey(42)).toBeUndefined();
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
