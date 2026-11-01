import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth";

const ORIGIN = "https://app.test";

describe("safeNext", () => {
  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["https://evil.com"],
    ["/%2F%2Fevil.com"],
    ["/%5Cevil.com"],
    ["/%2f%2fevil.com"],
    ["javascript:alert(1)"],
    [`/${"a".repeat(600)}`],
    ["/admin\u0000"],
    ["/\nadmin"],
    ["/%0aadmin"],
    ["/%E0%A4%A"],
    ["/settings"],
    [""],
    [undefined],
    [42],
  ])("sends %j to /", (raw) => {
    expect(safeNext(raw, ORIGIN)).toBe("/");
  });

  it("keeps the allowed paths", () => {
    expect(safeNext("/", ORIGIN)).toBe("/");
    expect(safeNext("/admin", ORIGIN)).toBe("/admin");
    expect(safeNext("/admin?tab=users", ORIGIN)).toBe("/admin");
  });
});
