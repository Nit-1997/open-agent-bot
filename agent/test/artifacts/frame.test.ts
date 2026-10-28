import { describe, expect, it } from "vitest";
import { withReportFrame } from "../../src/artifacts/frame.js";

describe("withReportFrame", () => {
  it("adds base styles and new-tab links ahead of the model's own head content", () => {
    const out = withReportFrame("<!doctype html><html><head><title>R</title><style>h1{color:red}</style></head><body><h1>R</h1></body></html>");
    expect(out.indexOf('<base target="_blank">')).toBeLessThan(out.indexOf("<title>R</title>"));
    expect(out.indexOf("max-width: 880px")).toBeLessThan(out.indexOf("h1{color:red}"));
    expect(out).toContain('<meta name="referrer" content="no-referrer">');
  });

  it("wraps fragments and head-less documents", () => {
    expect(withReportFrame("<h1>Only a fragment</h1>")).toMatch(/^<!doctype html><html><head>.*<\/head><body><h1>Only a fragment<\/h1><\/body><\/html>$/s);
    expect(withReportFrame("<html><body>x</body></html>")).toMatch(/^<html><head><meta charset="utf-8">/);
  });
});
