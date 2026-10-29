import { describe, expect, it } from "vitest";
import { evaluate, exactAt1, keywordRanker, loadRows, ndcgAt3 } from "../../evals/rank.js";

describe("ranking metrics", () => {
  it("exactAt1 checks the top label", () => {
    expect(exactAt1(["E", "S"])).toBe(1);
    expect(exactAt1(["S", "E"])).toBe(0);
    expect(exactAt1([])).toBe(0);
  });

  it("ndcgAt3 is 1 for the ideal order and lower otherwise", () => {
    const all = ["E", "S", "C", "I"] as const;
    expect(ndcgAt3(["E", "S", "C"], [...all])).toBeCloseTo(1, 6);
    expect(ndcgAt3(["S", "E", "C"], [...all])).toBeLessThan(1);
    expect(ndcgAt3([], [...all])).toBe(0);
    expect(ndcgAt3(["E"], ["I"])).toBe(0);
  });
});

describe("esci grocery fixture", () => {
  it("has labeled practice and test splits", () => {
    const rows = loadRows();
    expect(rows.filter((r) => r.split === "practice").length).toBeGreaterThan(30);
    expect(rows.filter((r) => r.split === "test").length).toBeGreaterThan(50);
    for (const r of rows) {
      expect(r.tiles.length).toBeGreaterThanOrEqual(8);
      expect(r.tiles.some((t) => t.label === "E")).toBe(true);
    }
  });

  it("computes keyword ranking metrics on the test split", async () => {
    const report = await evaluate(loadRows(undefined, "test"), keywordRanker);
    expect(report.n).toBeGreaterThan(50);
    expect(report.exact1).toBeGreaterThan(0.3);
    expect(report.exact1).toBeLessThanOrEqual(1);
    expect(report.ndcg3).toBeGreaterThan(0.3);
    expect(report.fallbacks).toBe(0);
  });
});
