import { describe, expect, it } from "vitest";
import { reportHtmlHref, reportPdfHref, reportThumbHref } from "../../src/lib/reports.ts";

describe("report hrefs", () => {
  it("keep plain ids unchanged", () => {
    expect(reportPdfHref("e2eReport001")).toBe("/api/artifacts/e2eReport001?format=pdf");
    expect(reportHtmlHref("e2eReport001")).toBe("/api/artifacts/e2eReport001");
    expect(reportThumbHref("e2eReport001")).toBe("/api/artifacts/e2eReport001?format=thumb");
  });

  it("encode the id so it stays one path segment with no query of its own", () => {
    expect(reportPdfHref("a/b?format=html#x")).toBe("/api/artifacts/a%2Fb%3Fformat%3Dhtml%23x?format=pdf");
    expect(reportHtmlHref("r 1")).toBe("/api/artifacts/r%201");
    expect(reportThumbHref("a&b")).toBe("/api/artifacts/a%26b?format=thumb");
  });

  it("refuse ids that are dot segments", () => {
    expect(() => reportHtmlHref("..")).toThrow(TypeError);
    expect(() => reportPdfHref(".")).toThrow(TypeError);
  });
});
