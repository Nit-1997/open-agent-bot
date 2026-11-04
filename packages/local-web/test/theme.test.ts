import { afterEach, describe, expect, it } from "vitest";
import { applyStoredTheme } from "../src/theme.ts";

const prefersDark = (dark: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: dark && query === "(prefers-color-scheme: dark)",
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("applyStoredTheme", () => {
  it.each([
    ["dark", false, true],
    ["light", true, false],
    [null, true, true],
    [null, false, false],
    ["purple", true, false],
  ] as const)("stored %s with system dark %s gives dark %s", (stored, system, dark) => {
    if (stored) localStorage.setItem("theme", stored);
    prefersDark(system);
    applyStoredTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(dark);
  });

  it("falls back to light when storage throws", () => {
    prefersDark(false);
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      applyStoredTheme();
    } finally {
      Storage.prototype.getItem = original;
    }
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
