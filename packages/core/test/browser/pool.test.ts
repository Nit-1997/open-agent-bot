import { describe, expect, it } from "vitest";
import { browseViewport } from "../../src/browser/pool.js";

const base = { timeZone: "UTC", locale: "en-US", localTime: "t" };

describe("browseViewport", () => {
  it("browses as a phone when the chat is narrow", () => {
    expect(browseViewport({ ...base, viewport: { width: 558, height: 698 } })).toEqual({ width: 430, height: 932 });
  });

  it("browses as a desktop when the chat is wide or unknown", () => {
    expect(browseViewport({ ...base, viewport: { width: 1440, height: 900 } })).toEqual({ width: 1280, height: 900 });
    expect(browseViewport(base)).toEqual({ width: 1280, height: 900 });
    expect(browseViewport(null)).toEqual({ width: 1280, height: 900 });
  });
});
