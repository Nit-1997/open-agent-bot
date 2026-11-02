import type { StoredMessage } from "@shared/chats";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toHistory } from "@/lib/chats";
import { parseArtifactId, reportsIn, reportTitleIn } from "@/lib/reportRefs";
import { type AutoOpenInput, shouldAutoOpen } from "@/lib/shell/autoOpen";
import { inertOutside } from "@/lib/shell/inertOutside";
import { clampPanel, DEFAULT_PANEL_FRACTION, fractionLimits, step } from "@/lib/shell/panelWidth";
import { readPanelFraction, writePanelFraction } from "@/lib/shell/reportPanelPref";
import { buildTurns, type ChatMessage } from "@/lib/turns";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("reportPanelPref", () => {
  it("reads and writes the panel fraction", () => {
    writePanelFraction(0.4234);
    expect(localStorage.getItem("oa.reportPanel")).toBe("0.423");
    expect(readPanelFraction()).toBe(0.423);
  });

  it.each(["abc", "0", "1.5", "-0.2", "1", ""])("falls back to 58 %% for %j", (raw) => {
    localStorage.setItem("oa.reportPanel", raw);
    expect(readPanelFraction()).toBe(DEFAULT_PANEL_FRACTION);
  });

  it("falls back to 58 % and never throws when localStorage does", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readPanelFraction()).toBe(0.58);
    expect(() => writePanelFraction(0.5)).not.toThrow();
  });
});

describe("panelWidth", () => {
  it.each([944, 1360, 2388])("keeps the chat at 360 px or more and the panel at 380 px or more (%i px available)", (available) => {
    for (const f of [0, 0.1, 0.3, 0.58, 0.8, 1]) {
      const panel = clampPanel(f, available);
      expect(panel).toBeGreaterThanOrEqual(380);
      expect(available - panel).toBeGreaterThanOrEqual(360);
    }
  });

  it("gives 380 to 584 px at the narrowest desktop and 58 % by default when there is room", () => {
    expect(clampPanel(0, 944)).toBe(380);
    expect(clampPanel(1, 944)).toBe(584);
    expect(clampPanel(DEFAULT_PANEL_FRACTION, 1360)).toBe(Math.round(0.58 * 1360));
  });

  it("steps 2 % on arrows, 10 % with Shift, and jumps to the limits on Home and End", () => {
    const limits = fractionLimits(1360);
    expect(step(0.5, "ArrowLeft", false, limits)).toBeCloseTo(0.52);
    expect(step(0.5, "ArrowRight", false, limits)).toBeCloseTo(0.48);
    expect(step(0.5, "ArrowLeft", true, limits)).toBeCloseTo(0.6);
    expect(step(0.5, "ArrowRight", true, limits)).toBeCloseTo(0.4);
    expect(step(0.5, "Home", false, limits)).toBe(limits.min);
    expect(step(0.5, "End", false, limits)).toBe(limits.max);
    expect(step(limits.max, "ArrowLeft", true, limits)).toBe(limits.max);
  });

  it("recomputes the limits when the window shrinks", () => {
    const wide = fractionLimits(2388);
    const narrow = fractionLimits(944);
    expect(narrow.min).toBeGreaterThan(wide.min);
    expect(narrow.max).toBeLessThan(wide.max);
    expect(clampPanel(wide.max, 944)).toBe(584);
  });
});

describe("reportRefs", () => {
  it("parses the id and title from both tools' results", () => {
    expect(parseArtifactId("artifact abcdefghijkl created: Plan 2 pictures shown.")).toBe("abcdefghijkl");
    expect(parseArtifactId("artifact A_c-efghijkl created: Big Sur\nRead 6 sources.")).toBe("A_c-efghijkl");
    expect(parseArtifactId("html too large")).toBeNull();
    expect(reportTitleIn("artifact A_c-efghijkl created: Big Sur\nRead 6 sources.")).toBe("Big Sur");
  });

  it("lists finished reports in chat order and skips pending and failed ones", () => {
    const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "two reports" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          call("c1", "create_artifact", { title: "First" }),
          call("c2", "research", { question: "q" }),
          call("c3", "create_artifact", { title: "Failed" }),
          call("c4", "create_artifact", { title: "Pending" }),
        ],
      },
      { id: "r1", role: "tool", toolCallId: "c1", content: "artifact aaaaaaaaaaaa created: First" },
      { id: "r2", role: "tool", toolCallId: "c2", content: "artifact bbbbbbbbbbbb created: Second\nRead 3 sources." },
      { id: "r3", role: "tool", toolCallId: "c3", content: "html too large" },
    ];
    expect(reportsIn(buildTurns(messages))).toEqual([
      { reportId: "aaaaaaaaaaaa", toolCallId: "c1", title: "First" },
      { reportId: "bbbbbbbbbbbb", toolCallId: "c2", title: "Second" },
    ]);
  });

  it("handles backfilled saved-<id> tool calls from history", () => {
    const at = "2026-11-01T00:00:00Z";
    const stored: StoredMessage[] = [
      { role: "user", content: "guide", status: "complete", createdAt: at },
      {
        role: "assistant",
        content: "Here.",
        status: "complete",
        createdAt: at,
        parts: [
          {
            type: "tool",
            id: "saved-abcdefghijkl",
            name: "create_artifact",
            args: '{"title":"Big Sur guide"}',
            result: "artifact abcdefghijkl created: Big Sur guide",
          },
        ],
      },
    ];
    expect(reportsIn(buildTurns(toHistory("chat", stored) as ChatMessage[]))).toEqual([
      { reportId: "abcdefghijkl", toolCallId: "saved-abcdefghijkl", title: "Big Sur guide" },
    ]);
  });
});

describe("shouldAutoOpen", () => {
  const base: AutoOpenInput = {
    tool: "create_artifact",
    reportId: "abcdefghijkl",
    active: true,
    visible: true,
    breakpoint: "desktop",
    overlay: "none",
    dismissed: false,
    picked: false,
    panelOpen: false,
  };

  it("opens when every condition holds, for both report tools", () => {
    expect(shouldAutoOpen(base)).toBe(true);
    expect(shouldAutoOpen({ ...base, tool: "research" })).toBe(true);
    expect(shouldAutoOpen({ ...base, picked: true, panelOpen: false })).toBe(true);
    expect(shouldAutoOpen({ ...base, panelOpen: true })).toBe(true);
  });

  it.each<[string, Partial<AutoOpenInput>]>([
    ["another tool", { tool: "fetch_page" }],
    ["no artifact id", { reportId: null }],
    ["an inactive pane", { active: false }],
    ["a hidden chat route", { visible: false }],
    ["a tablet", { breakpoint: "tablet" }],
    ["a phone", { breakpoint: "phone" }],
    ["an open shell overlay", { overlay: "profile" }],
    ["a panel the user closed this run", { dismissed: true }],
    ["a report the user picked this run", { picked: true, panelOpen: true }],
  ])("doesn't open for %s", (_, over) => {
    expect(shouldAutoOpen({ ...base, ...over })).toBe(false);
  });
});

describe("inertOutside", () => {
  it("sets inert on siblings up to the root, skips kept and already-inert nodes, and removes exactly what it added", () => {
    document.body.innerHTML = `
      <div id="root">
        <nav id="rail"></nav>
        <main id="main">
          <div id="host">
            <section id="pane-a" inert></section>
            <section id="pane-b">
              <div id="column"></div>
              <div id="backdrop"></div>
              <aside id="panel"><button id="inside"></button></aside>
              <p id="status"></p>
            </section>
          </div>
          <div id="children"></div>
        </main>
        <div id="tabs"></div>
      </div>`;
    const $ = (id: string) => document.getElementById(id)!;
    const undo = inertOutside($("panel"), $("root"), [$("backdrop")]);
    const inert = () => [...document.querySelectorAll("[inert]")].map((e) => e.id).sort();
    expect(inert()).toEqual(["children", "column", "pane-a", "rail", "status", "tabs"]);
    expect($("root").hasAttribute("inert")).toBe(false);
    expect($("backdrop").hasAttribute("inert")).toBe(false);
    undo();
    expect(inert()).toEqual(["pane-a"]);
  });
});
