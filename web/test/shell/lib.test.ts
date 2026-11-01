import { emptyProfile, type Profile } from "@shared/profile";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupByDate, groupItems } from "@/lib/dateGroups";
import { isolate, knowsSummary, rememberLine } from "@/lib/persona";
import { currentBreakpoint } from "@/lib/shell/breakpoints";
import { chatReducer, initialChatState, isUntouchedDraft, MAX_PANES, mountedIds } from "@/lib/shell/chatController";
import { readSidebarOpen, writeSidebarOpen } from "@/lib/shell/sidebarPref";
import { mockViewport } from "../support/media";

describe("groupByDate", () => {
  const now = new Date(2026, 10, 1, 9, 30);
  it("puts today, the previous six days and the rest in their groups", () => {
    expect(groupByDate(new Date(2026, 10, 1, 0, 0).toISOString(), now)).toBe("today");
    expect(groupByDate(new Date(2026, 9, 31, 23, 59).toISOString(), now)).toBe("week");
    expect(groupByDate(new Date(2026, 9, 26, 0, 0).toISOString(), now)).toBe("week");
    expect(groupByDate(new Date(2026, 9, 25, 23, 59).toISOString(), now)).toBe("earlier");
  });

  it("counts local calendar days across a DST change", () => {
    const after = new Date(2026, 2, 10, 8, 0);
    expect(groupByDate(new Date(2026, 2, 4, 0, 30).toISOString(), after)).toBe("week");
    expect(groupByDate(new Date(2026, 2, 3, 23, 30).toISOString(), after)).toBe("earlier");
  });

  it("keeps groups in order and items newest first", () => {
    const items = [new Date(2026, 10, 1, 8), new Date(2026, 9, 30), new Date(2026, 9, 1)].map((d) => d.toISOString());
    expect(groupItems(items, (x) => x, now).map((g) => [g.group, g.items.length])).toEqual([
      ["today", 1],
      ["week", 1],
      ["earlier", 1],
    ]);
  });
});

const known: Profile = {
  ...emptyProfile(),
  home: { label: "San Luis Obispo, CA", city: "San Luis Obispo" },
  food: ["No restrictions", "Vegetarian"],
  travel: { ...emptyProfile().travel, style: "budget" },
};

describe("persona helpers", () => {
  it("summarises what the agent knows in order and cuts at 40 characters", () => {
    expect(knowsSummary(known)).toEqual({
      text: "San Luis Obispo, vegetarian, budget tri…",
      full: "San Luis Obispo, vegetarian, budget trips",
    });
    expect(knowsSummary({ ...emptyProfile(), food: ["Vegan"] })?.text).toBe("vegan");
    expect(knowsSummary(emptyProfile())).toBeNull();
  });

  it("writes a remember line with one, two or three facts and none", () => {
    expect(rememberLine(known, "Juno")).toBe(
      "Juno remembers your home in San Luis Obispo, that you're vegetarian, and that you travel on a budget.",
    );
    expect(rememberLine({ ...emptyProfile(), food: ["Nut allergy"], travel: { ...known.travel, style: "luxury" } }, "Ivy")).toBe(
      "Ivy remembers about your nut allergy and that you like to travel in luxury.",
    );
    expect(rememberLine({ ...emptyProfile(), food: ["Halal"] }, "Ivy")).toBe("Ivy remembers that you eat halal.");
    expect(rememberLine(emptyProfile(), "Ivy")).toBeNull();
  });

  it("isolates a name inside attribute text", () => {
    expect(isolate("ليلى")).toBe("⁨ليلى⁩");
  });
});

describe("sidebarPref", () => {
  afterEach(() => vi.restoreAllMocks());
  it("reads and writes the choice and treats anything else as open", () => {
    localStorage.removeItem("oa.sidebar");
    expect(readSidebarOpen()).toBe(true);
    writeSidebarOpen(false);
    expect(localStorage.getItem("oa.sidebar")).toBe("collapsed");
    expect(readSidebarOpen()).toBe(false);
    localStorage.setItem("oa.sidebar", "garbage");
    expect(readSidebarOpen()).toBe(true);
  });

  it("falls back to open when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSidebarOpen()).toBe(true);
    expect(() => writeSidebarOpen(false)).not.toThrow();
  });
});

describe("breakpoints", () => {
  it.each([
    [390, "phone"],
    [800, "tablet"],
    [1440, "desktop"],
  ] as const)("picks the chrome at %i px", (width, expected) => {
    mockViewport(width);
    expect(currentBreakpoint()).toBe(expected);
  });
});

describe("chatController", () => {
  it("mounts the active thread plus at most two running ones", () => {
    let s = initialChatState("d0");
    for (const id of ["a", "b", "c"]) {
      s = chatReducer(s, { type: "open", id });
      s = chatReducer(s, { type: "running", id, running: true });
    }
    s = chatReducer(s, { type: "open", id: "e" });
    expect(mountedIds(s)).toHaveLength(MAX_PANES);
    expect(mountedIds(s)).toEqual(["e", "b", "c"]);
    s = chatReducer(s, { type: "running", id: "b", running: false });
    expect(mountedIds(s)).toEqual(["e", "c"]);
    expect(s.threads.b).toBeUndefined();
  });

  it("keeps the draft until it is claimed, then makes a fresh one for /", () => {
    let s = initialChatState("d0", "Taco night");
    expect(isUntouchedDraft(s.threads.d0)).toBe(true);
    expect(s.threads.d0.starter).toBe("Taco night");
    s = chatReducer(s, { type: "showDraft", freshId: "d1" });
    expect(s.activeId).toBe("d0");
    s = chatReducer(s, { type: "running", id: "d0", running: true });
    expect(isUntouchedDraft(s.threads.d0)).toBe(false);
    s = chatReducer(s, { type: "claimed", id: "d0", title: "hello" });
    s = chatReducer(s, { type: "open", id: "d0" });
    expect(s.threads.d0).toMatchObject({ claimed: true, title: "hello", status: "ready" });
    s = chatReducer(s, { type: "showDraft", freshId: "d1" });
    expect([s.activeId, s.draftId]).toEqual(["d1", "d1"]);
    expect(s.threads.d0).toBeDefined();
  });

  it("loads, fails and retries an opened chat, and keeps the model per thread", () => {
    let s = chatReducer(initialChatState("d0"), { type: "open", id: "c1" });
    expect(s.threads.c1.status).toBe("loading");
    s = chatReducer(s, { type: "failed", id: "c1", missing: false, error: "down" });
    expect(s.threads.c1).toMatchObject({ status: "error", error: "down" });
    s = chatReducer(s, { type: "retry", id: "c1" });
    expect(s.threads.c1).toMatchObject({ status: "loading", attempt: 1 });
    s = chatReducer(s, { type: "loaded", id: "c1", title: "T", history: [] });
    s = chatReducer(s, { type: "model", id: "c1", model: "openrouter/x" });
    expect(s.threads.c1).toMatchObject({ status: "ready", title: "T", model: "openrouter/x" });
    expect(s.threads.d0.model).toBeUndefined();
  });
});
