import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { chatIndex } from "@/lib/chatIndex";
import { copilot } from "../support/copilot";
import { expectUniqueIds } from "../support/ids";
import { mockViewport } from "../support/media";
import { syncHistory } from "../support/navigation";
import { flush, nav, renderShell } from "../support/shell";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());
vi.mock("@copilotkit/react-core/v2", async () => (await import("../support/copilot")).copilotMock());

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const R1 = "bigSurStays1";
const R2 = "campingGear2";
const OTHER = "otherChat001";
const MISSING = "missingRep01";
const BROKEN = "brokenRep001";
const LIVE = "packingList3";

const tool = (id: string, title: string) => ({
  type: "tool",
  id,
  name: "create_artifact",
  args: JSON.stringify({ title }),
  result: `artifact ${id.replace("c-", "")} created: ${title}`,
});

const histories: Record<string, unknown[]> = {
  [A]: [
    { role: "user", content: "plan big sur", status: "complete", createdAt: "x" },
    {
      role: "assistant",
      content: "Here are two reports.",
      status: "complete",
      createdAt: "x",
      parts: [tool(`c-${R1}`, "Big Sur stays"), tool(`c-${R2}`, "Camping gear"), { type: "text", text: "Here are two reports." }],
    },
  ],
  [B]: [{ role: "user", content: "hello b", status: "complete", createdAt: "x" }],
};

const summary = (id: string, title: string, chatId: string | null) => ({
  report: { id, title, createdAt: "2026-11-01T00:00:00Z", chatId, chatTitle: "Big Sur", pdfReady: false, sizeBytes: 10 },
});

let reportDelay: Promise<void> | null = null;
let failReports = 0;

beforeEach(() => {
  copilot.reset();
  chatIndex.reset();
  localStorage.clear();
  mockViewport(1440);
  reportDelay = null;
  failReports = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const chat = /^\/api\/chats\/([0-9a-f-]{36})(\/messages)?$/.exec(url);
      if (chat?.[2]) return Response.json({ items: histories[chat[1]] ?? [], total: 1 });
      if (chat) return Response.json({ chat: { id: chat[1], title: `Chat ${chat[1].slice(0, 1)}`, lastMessageAt: new Date().toISOString() } });
      if (url.startsWith("/api/chats?")) return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
      const rep = /^\/api\/reports\/([\w-]{12})$/.exec(url);
      if (rep) {
        if (reportDelay) await reportDelay;
        const id = rep[1];
        if (id === MISSING) return Response.json({ error: "not_found" }, { status: 404 });
        if (id === BROKEN && failReports-- > 0) return Response.json({ error: "internal", message: "down" }, { status: 500 });
        if (id === OTHER) return Response.json(summary(id, "Other chat's report", B));
        const titles: Record<string, string> = { [R1]: "Big Sur stays", [R2]: "Camping gear", [LIVE]: "Packing list", [BROKEN]: "Broken" };
        return Response.json(summary(id, titles[id] ?? "Report", A));
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
});

let hist: ReturnType<typeof syncHistory>;
beforeEach(() => {
  hist = syncHistory();
  nav.reset("/");
});
afterEach(() => {
  hist.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const go = async (path: string) => {
  await act(async () => hist.visit(path));
  await flush();
};
const $ = (id: string) => document.getElementById(id);
const pane = (t = A) => `chat-pane-${t}`;
const panelId = (t = A) => `${pane(t)}-report-panel`;
const card = (r: string, t = A) => $(`${pane(t)}-artifact-card-c-${r}`)!;
const raf = () => act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));

async function openChat(t = A) {
  await go(`/chats/${t}`);
  await waitFor(() => expect($(`${pane(t)}-composer-input`)).not.toBeNull());
  if (t === A) await waitFor(() => expect(card(R1)).not.toBeNull());
}

async function clickCard(r: string, t = A) {
  await act(async () => fireEvent.click(card(r, t)));
  await waitFor(() => expect($(`${panelId(t)}-frame`)).not.toBeNull());
  await raf();
}

const contexts = (agent: string, description: string) =>
  [...copilot.contexts.values()].filter((c) => c.agentIds?.includes(agent) && c.description === description);

describe("report panel on desktop", () => {
  it("opens from a card, swaps with Next, closes back to the card, and keeps the sidebar pref", async () => {
    const { container } = renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    expect($("sidebar")).not.toBeNull();
    const length = window.history.length;
    await clickCard(R1);
    const panel = $(panelId())!;
    expect(panel.tagName).toBe("ASIDE");
    expect(panel).toHaveAttribute("aria-label", "Report");
    expect(document.activeElement).toBe($(`${panelId()}-title`));
    expect($(`${panelId()}-position`)).toHaveTextContent("Report · 1 of 2 in this chat");
    expect($(`${panelId()}-prev`)).toHaveAttribute("aria-disabled", "true");
    expect($(`${panelId()}-next`)).toHaveAttribute("aria-disabled", "false");
    expect(card(R1)).toHaveAttribute("aria-pressed", "true");
    expect(card(R2)).toHaveAttribute("aria-pressed", "false");
    expect($(`${panelId()}-frame`)).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect($(`${panelId()}-pdf`)).toHaveAttribute("href", `/api/artifacts/${R1}?format=pdf`);
    expect($(`${panelId()}-pdf`)).toHaveAttribute("download");
    expect($(`${panelId()}-new-tab`)).toHaveAttribute("href", `/api/artifacts/${R1}`);
    expect($(`${panelId()}-new-tab`)).toHaveAttribute("target", "_blank");
    expect($(`${panelId()}-new-tab`)).toHaveAttribute("rel", "noopener noreferrer");
    expect(window.location.search).toBe(`?report=${R1}`);
    expect(window.history.length).toBe(length);
    expect($("sidebar")).toBeNull();
    expect($("rail-new-chat")).not.toBeNull();
    expect($("rail-chats")).toHaveAttribute("href", `/chats/${A}?report=${R1}`);
    expect($(`${pane()}-composer-input`)).toHaveAttribute("placeholder", "Ask about this report…");
    expectUniqueIds(container);

    await act(async () => fireEvent.click($(`${panelId()}-prev`)!));
    expect(window.location.search).toBe(`?report=${R1}`);
    await act(async () => fireEvent.click($(`${panelId()}-next`)!));
    await waitFor(() => expect($(`${panelId()}-position`)).toHaveTextContent("Report · 2 of 2 in this chat"));
    expect(card(R2)).toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe(`?report=${R2}`);
    expect(window.history.length).toBe(length);
    expect($(`${panelId()}-next`)).toHaveAttribute("aria-disabled", "true");

    await act(async () => fireEvent.click($(`${panelId()}-close`)!));
    await raf();
    expect($(panelId())).toBeNull();
    expect(document.activeElement).toBe(card(R2));
    expect(window.location.search).toBe("");
    expect($("sidebar")).not.toBeNull();
    expect($(`${pane()}-composer-input`)?.getAttribute("placeholder")).not.toBe("Ask about this report…");
    expect(localStorage.getItem("oa.sidebar")).toBeNull();
  });

  it("keeps a collapsed sidebar collapsed after close, and opens the sidebar as an overlay while the panel is inline", async () => {
    localStorage.setItem("oa.sidebar", "collapsed");
    const { container } = renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    const toggle = $("rail-sidebar-toggle")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await act(async () => fireEvent.click(toggle));
    expect($("sidebar-overlay")).not.toBeNull();
    expect(document.querySelectorAll("#sidebar")).toHaveLength(1);
    expectUniqueIds(container);
    expectUniqueIds(document.body.querySelector("#sidebar-overlay")!);
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect($("sidebar-overlay")).toBeNull();
    expect($(panelId())).not.toBeNull();
    await act(async () => fireEvent.click($(`${panelId()}-close`)!));
    expect($("sidebar")).toHaveAttribute("hidden");
    expect(localStorage.getItem("oa.sidebar")).toBe("collapsed");
  });

  it("tells only its own pane's agent which report is open, and follows swaps and closes", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat(B);
    const input = $(`${pane(B)}-composer-input`) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "keep running" } });
    await act(async () => fireEvent.submit(input.closest("form")!));
    await openChat(A);
    expect(contexts(`chat-${A}`, "open_report")).toHaveLength(0);
    await clickCard(R1);
    expect(contexts(`chat-${A}`, "open_report").map((c) => JSON.parse(c.value))).toEqual([
      { openReport: { id: R1, title: "Big Sur stays" } },
    ]);
    expect(contexts(`chat-${B}`, "open_report")).toHaveLength(0);
    await act(async () => fireEvent.click($(`${panelId()}-next`)!));
    expect(contexts(`chat-${A}`, "open_report").map((c) => JSON.parse(c.value))).toEqual([
      { openReport: { id: R2, title: "Camping gear" } },
    ]);
    await act(async () => fireEvent.click($(`${panelId()}-close`)!));
    expect(contexts(`chat-${A}`, "open_report")).toHaveLength(0);
    expectUniqueIds(document.getElementById("chat-host")!);
  });

  it("closes on Escape from inside the panel but not from the composer", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    await act(async () => fireEvent.keyDown($(`${pane()}-composer-input`)!, { key: "Escape" }));
    expect($(panelId())).not.toBeNull();
    await act(async () => fireEvent.keyDown($(`${panelId()}-title`)!, { key: "Escape" }));
    await raf();
    expect($(panelId())).toBeNull();
    expect(document.activeElement).toBe(card(R1));
  });
});

describe("report viewer states", () => {
  it("loads metadata before the frame, and shows missing, other chat and error with Retry", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    let release!: () => void;
    reportDelay = new Promise((r) => (release = r));
    await go(`/chats/${A}?report=${R1}`);
    await waitFor(() => expect($(panelId())).not.toBeNull());
    expect($(`${panelId()}-loading`)).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector("iframe")).toBeNull();
    expect($(`${panelId()}-close`)).not.toBeNull();
    await act(async () => release());
    await waitFor(() => expect($(`${panelId()}-frame`)).toHaveAttribute("sandbox"));
    reportDelay = null;

    await go(`/chats/${A}?report=${MISSING}`);
    expect(await screen.findByText("This report doesn't exist or isn't yours.")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();

    await go(`/chats/${A}?report=${OTHER}`);
    expect(await screen.findByText("This report is from another chat.")).toBeInTheDocument();
    expect($(`${panelId()}-other-chat-link`)).toHaveAttribute("href", `/reports/${OTHER}`);
    expect($(`${panelId()}-position`)).toHaveTextContent("Report");
    expect($(`${panelId()}-prev`)).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();

    failReports = 1;
    await go(`/chats/${A}?report=${BROKEN}`);
    expect(await screen.findByText(/Couldn't load this report/)).toBeInTheDocument();
    await act(async () => fireEvent.click($(`${panelId()}-error-retry`)!));
    await waitFor(() => expect($(`${panelId()}-frame`)).not.toBeNull());
  });
});

describe("panel separator", () => {
  it("exposes its value, steps with the keys, writes once per key, and resets on double-click", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    const sep = $(`${pane()}-report-separator`)!;
    expect(sep).toHaveAttribute("role", "separator");
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-controls", panelId());
    expect(sep).toHaveAttribute("aria-valuenow", "58");
    expect(sep).toHaveAttribute("aria-valuetext", "Report panel, 58 percent");
    expect(sep).toHaveAttribute("tabindex", "0");
    const writes = () => setItem.mock.calls.filter(([k]) => k === "oa.reportPanel").length;
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "60");
    fireEvent.keyDown(sep, { key: "ArrowRight", shiftKey: true });
    expect(sep).toHaveAttribute("aria-valuenow", "50");
    expect(writes()).toBe(2);
    fireEvent.keyDown(sep, { key: "Home" });
    expect(sep).toHaveAttribute("aria-valuenow", sep.getAttribute("aria-valuemin")!);
    fireEvent.keyDown(sep, { key: "End" });
    expect(sep).toHaveAttribute("aria-valuenow", sep.getAttribute("aria-valuemax")!);
    expect(writes()).toBe(4);
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute("aria-valuenow", "58");
    expect(localStorage.getItem("oa.reportPanel")).toBe("0.580");
  });

  it("turns off pointer events on the pane's frames during a drag and writes once on release", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    const section = $(pane())!;
    vi.spyOn(section, "clientWidth", "get").mockReturnValue(1372);
    vi.spyOn(section, "getBoundingClientRect").mockReturnValue({ left: 68, right: 1440, top: 0, bottom: 900 } as DOMRect);
    await act(async () => window.dispatchEvent(new Event("resize")));
    const sep = $(`${pane()}-report-separator`)!;
    const frame = $(`${panelId()}-frame`) as HTMLIFrameElement;
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.pointerDown(sep, { button: 0, pointerId: 1, clientX: 600 });
    expect(frame.style.pointerEvents).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 700 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 720 });
    expect(setItem.mock.calls.filter(([k]) => k === "oa.reportPanel")).toHaveLength(0);
    fireEvent.pointerUp(sep, { pointerId: 1, clientX: 720 });
    expect(frame.style.pointerEvents).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(setItem.mock.calls.filter(([k]) => k === "oa.reportPanel")).toHaveLength(1);
  });

  it("still works when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    const sep = $(`${pane()}-report-separator`)!;
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "60");
  });
});

describe("tablet overlay", () => {
  it("is a modal dialog: focus moves in, Tab stays inside, the rest is inert, and Escape or the backdrop close it", async () => {
    mockViewport(800);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    expect(card(R1)).toHaveTextContent("Report · tap to read");
    await clickCard(R1);
    const panel = $(panelId())!;
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAttribute("aria-labelledby", `${panelId()}-title`);
    expect(document.activeElement).toBe($(`${panelId()}-title`));
    expect($("rail")).toHaveAttribute("inert");
    expect($(`${pane()}-column`)).toHaveAttribute("inert");
    expect($(`${pane()}-report-backdrop`)).not.toHaveAttribute("inert");
    expect($(`${pane()}-report-separator`)).toBeNull();
    $(`${panelId()}-close`)!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(panel.contains(document.activeElement)).toBe(true);
    $(`${panelId()}-pdf`)!.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(panel.contains(document.activeElement)).toBe(true);

    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    await raf();
    expect($(panelId())).toBeNull();
    expect(document.activeElement).toBe(card(R1));
    expect($("rail")).not.toHaveAttribute("inert");
    expect($(`${pane()}-column`)).not.toHaveAttribute("inert");

    await clickCard(R2);
    await act(async () => fireEvent.click($(`${pane()}-report-backdrop`)!));
    await raf();
    expect($(panelId())).toBeNull();
    expect(document.activeElement).toBe(card(R2));
    expect(document.querySelectorAll("[inert]").length).toBe(0);
  });

  it("opens the overlay from the URL and never auto-opens; it announces instead", async () => {
    mockViewport(800);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await go(`/chats/${A}?report=${R1}`);
    await waitFor(() => expect($(panelId())).toHaveAttribute("role", "dialog"));
    await act(async () => fireEvent.click($(`${panelId()}-close`)!));
    await startRun();
    act(() => copilot.agents.get(`chat-${A}`)!.toolCall("t-live", "create_artifact", { title: "Packing list" }, `artifact ${LIVE} created: Packing list`));
    await flush();
    expect($(panelId())).toBeNull();
    expect($(`${pane()}-report-status`)).toHaveTextContent("Report ready: “Packing list”.");
  });
});

describe("phone viewer", () => {
  it("is a full-screen dialog pushed on the history; Back and the back arrow close it", async () => {
    mockViewport(390);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    const push = vi.mocked(window.history.pushState);
    await clickCard(R1);
    const panel = $(panelId())!;
    expect(panel).toHaveAttribute("role", "dialog");
    expect($(`${panelId()}-back`)).toHaveAccessibleName("Back to chat");
    expect($(`${panelId()}-pdf`)).toHaveAccessibleName("Download PDF");
    expect($(`${panelId()}-new-tab`)).toHaveAccessibleName("Open in a new tab");
    expect($(`${panelId()}-prev`)).toBeNull();
    expect($(`${panelId()}-close`)).toBeNull();
    expect(push).toHaveBeenCalledWith({ oaReport: R1 }, "", `/chats/${A}?report=${R1}`);
    const back = vi.spyOn(window.history, "back");
    await act(async () => fireEvent.click($(`${panelId()}-back`)!));
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect($(panelId())).toBeNull());
    await raf();
    expect(window.location.search).toBe("");
    expect(document.activeElement).toBe(card(R1));
  });

  it("goes back even when history.state lost oaReport, and replaces when opened from the URL", async () => {
    mockViewport(390);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    window.history.replaceState({}, "", `/chats/${A}?report=${R1}`);
    const back = vi.spyOn(window.history, "back");
    await act(async () => fireEvent.click($(`${panelId()}-back`)!));
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect($(panelId())).toBeNull());

    back.mockClear();
    await go(`/chats/${A}?report=${R2}`);
    await waitFor(() => expect($(panelId())).not.toBeNull());
    await act(async () => fireEvent.click($(`${panelId()}-back`)!));
    expect(back).not.toHaveBeenCalled();
    expect($(panelId())).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("iframe continuity", () => {
  it("keeps one frame across pane switches, a trip to Reports, and both breakpoints", async () => {
    const vp = mockViewport(1440);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    const frame = $(`${panelId()}-frame`);
    const input = $(`${pane()}-composer-input`) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "keep running" } });
    await act(async () => fireEvent.submit(input.closest("form")!));
    await openChat(B);
    expect($(pane())).toHaveAttribute("hidden");
    await go(`/chats/${A}`);
    expect($(`${panelId()}-frame`)).toBe(frame);
    expect(window.location.search).toBe(`?report=${R1}`);
    await go("/reports");
    await go(`/chats/${A}?report=${R1}`);
    expect($(`${panelId()}-frame`)).toBe(frame);
    await act(async () => vp.resize(900));
    expect($(`${panelId()}-frame`)).toBe(frame);
    expect(document.activeElement).toBe($(`${panelId()}-title`));
    await act(async () => vp.resize(390));
    expect($(`${panelId()}-frame`)).toBe(frame);
    await act(async () => vp.resize(1440));
    expect($(`${panelId()}-frame`)).toBe(frame);
    expect($(panelId())).toHaveAttribute("aria-label", "Report");
    expect($(panelId())).not.toHaveAttribute("role");
  });
});

async function startRun(t = A) {
  const input = $(`${pane(t)}-composer-input`) as HTMLTextAreaElement;
  input.focus();
  fireEvent.change(input, { target: { value: "make a packing list" } });
  await act(async () => fireEvent.submit(input.closest("form")!));
  await flush();
  input.focus();
}

const live = (t = A, id = "t-live", report = LIVE, title = "Packing list", name = "create_artifact") =>
  act(() => copilot.agents.get(`chat-${t}`)!.toolCall(id, name, { title }, `artifact ${report} created: ${title}`));

describe("auto-open", () => {
  it("opens a report finished live on the right, replaces the URL and keeps focus in the composer", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    const length = window.history.length;
    await startRun();
    await live();
    await waitFor(() => expect($(panelId())).not.toBeNull());
    expect(window.location.search).toBe(`?report=${LIVE}`);
    expect(window.history.length).toBe(length);
    expect(document.activeElement).toBe($(`${pane()}-composer-input`));
    expect($(`${pane()}-report-status`)).toHaveTextContent("Opened “Packing list” on the right.");
  });

  it("ends on the newest of two reports in one run, unless the user picked one in between", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await startRun();
    await live(A, "t1", R1, "Big Sur stays");
    await live(A, "t2", R2, "Camping gear");
    await waitFor(() => expect(window.location.search).toBe(`?report=${R2}`));
    await act(async () => fireEvent.click(card(R1)));
    await live(A, "t3", LIVE, "Packing list");
    await flush();
    expect(window.location.search).toBe(`?report=${R1}`);
  });

  it("doesn't reopen after the user closed the panel in this run", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await startRun();
    await live(A, "t1", R1, "Big Sur stays");
    await waitFor(() => expect($(panelId())).not.toBeNull());
    await act(async () => fireEvent.click($(`${panelId()}-close`)!));
    await live(A, "t2", LIVE, "Packing list");
    await flush();
    expect($(panelId())).toBeNull();
    expect($(`${pane()}-report-status`)).toHaveTextContent("Report ready: “Packing list”.");
  });

  it("doesn't open for another tool or under the profile drawer", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await startRun();
    await live(A, "t0", LIVE, "Packing list", "fetch_page");
    await flush();
    expect($(panelId())).toBeNull();
    await act(async () => fireEvent.click($("agent-card")!));
    expect($("profile-drawer")).not.toBeNull();
    await live(A, "t1", LIVE, "Packing list");
    await flush();
    expect($(panelId())).toBeNull();
  });

  it("doesn't open for reports in history, or for a report finished in a hidden pane", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    expect($(panelId())).toBeNull();
    await startRun();
    await openChat(B);
    await live(A, "t1", LIVE, "Packing list");
    await flush();
    expect($(panelId())).toBeNull();
    await go(`/chats/${A}`);
    expect($(panelId())).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("URL sync", () => {
  it("restores a remembered panel on desktop by replace, closes it on a phone arrival, and lets Back swap", async () => {
    const vp = mockViewport(1440);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await openChat();
    await clickCard(R1);
    await openChat(B);
    await go(`/chats/${A}`);
    await waitFor(() => expect(window.location.search).toBe(`?report=${R1}`));
    expect($(panelId())).not.toBeNull();
    await act(async () => fireEvent.click($(`${panelId()}-next`)!));
    await go(`/chats/${A}?report=${R1}`);
    await waitFor(() => expect($(`${panelId()}-position`)).toHaveTextContent("1 of 2"));
    await openChat(B);
    await act(async () => vp.resize(390));
    await go(`/chats/${A}`);
    expect($(panelId())).toBeNull();
  });
});

describe("focus guard", () => {
  it("returns focus to the composer when the frame takes it without user input after a URL open", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await go(`/chats/${A}?report=${R1}`);
    const frame = (await waitFor(() => $(`${panelId()}-frame`)!)) as HTMLIFrameElement;
    fireEvent.load(frame);
    frame.focus();
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe($(`${pane()}-composer-input`));
  });

  it("leaves focus alone after a pointerdown in the panel", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await go(`/chats/${A}?report=${R1}`);
    const frame = (await waitFor(() => $(`${panelId()}-frame`)!)) as HTMLIFrameElement;
    fireEvent.load(frame);
    fireEvent.pointerDown($(`${panelId()}-body`)!);
    frame.focus();
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.activeElement).toBe(frame);
  });
});
