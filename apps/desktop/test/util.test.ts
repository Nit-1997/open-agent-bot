import { describe, expect, it } from "vitest";
import { formatBytes, lastLines, obj } from "../src/shared/util.ts";

describe("shared helpers (C10)", () => {
  it("formats sizes one way everywhere", () => {
    expect([0, 1, 1024, 1536, 3 * 1024 ** 2, 2.5 * 1024 ** 2, 2 * 1024 ** 3, 1.25 * 1024 ** 3].map(formatBytes)).toEqual([
      "0 KB",
      "1 KB",
      "1 KB",
      "2 KB",
      "3 MB",
      "3 MB",
      "2.0 GB",
      "1.3 GB",
    ]);
  });
  it("keeps the last non-empty lines", () => {
    expect(lastLines("a\n\nb\r\nc\n", 2)).toBe("b\nc");
  });
  it("accepts only plain objects", () => {
    expect([obj({ a: 1 }), obj([]), obj(null), obj("x")]).toEqual([{ a: 1 }, undefined, undefined, undefined]);
  });
});
