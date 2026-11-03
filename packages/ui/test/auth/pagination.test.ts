import { describe, expect, it } from "vitest";
import { parsePage } from "@oab/shared/pages";
import { pageCount, rangeText } from "../../src/lib/pagination.ts";

describe("pagination", () => {
  it("describes the visible range", () => {
    expect(rangeText(1, 5, 16)).toBe("Showing 1–5 of 16");
    expect(rangeText(2, 5, 16)).toBe("Showing 6–10 of 16");
    expect(rangeText(4, 5, 16)).toBe("Showing 16–16 of 16");
    expect(rangeText(1, 5, 0)).toBe("Showing 0 of 0");
    expect(pageCount(5, 16)).toBe(4);
  });

  it("parses page numbers strictly", () => {
    expect(parsePage(null)).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage(2)).toBe(2);
    expect(parsePage("0")).toBeNull();
    expect(parsePage("-1")).toBeNull();
    expect(parsePage("1e3")).toBeNull();
    expect(parsePage("2&admin=1")).toBeNull();
  });
});
