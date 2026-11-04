import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boundaryViolations, ENTRIES, readSourceTree } from "../../lint/boundary.js";

const SRC = join(import.meta.dirname, "../../../src");

describe("hosted boundary on src/", () => {
  const tree = readSourceTree(SRC);

  it("has a hosted folder", () => {
    expect(Object.keys(tree).filter((f) => f.startsWith("hosted/")).length).toBeGreaterThan(10);
  });

  it("has no B1–B6 violations", () => {
    expect(boundaryViolations(tree)).toEqual([]);
  });

  it("needs no temporary exception", () => {
    const strict = boundaryViolations(tree, { b1: ENTRIES, b3: [] });
    expect(strict).toEqual([]);
  });
});
