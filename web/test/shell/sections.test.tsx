import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSection } from "@/components/agent/AgentSection";
import { EmptyState } from "@/components/chat/EmptyState";
import { PlanDetail } from "@/components/plans/PlanDetail";
import { PlansView } from "@/components/plans/PlansView";
import { ReportDetail } from "@/components/reports/ReportDetail";
import { ReportsView } from "@/components/reports/ReportsView";
import { highlightParts } from "@/components/search/Highlight";
import { SearchView } from "@/components/search/SearchView";
import { DEFAULT_AGENT } from "@shared/profile";
import { expectUniqueIds } from "../support/ids";
import { mockViewport } from "../support/media";
import { nav } from "../support/navigation";
import { renderShell } from "../support/shell";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());

const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const rid = (n: number) => `report${String(n).padStart(6, "0")}`;
const reports = (page: number, total = 13) =>
  Array.from({ length: Math.max(0, Math.min(12, total - (page - 1) * 12)) }, (_, i) => {
    const n = (page - 1) * 12 + i + 1;
    return {
      id: rid(n),
      title: `Report ${n}`,
      createdAt: "2026-10-30T10:00:00Z",
      chatId: n === 2 ? null : CHAT,
      chatTitle: n === 2 ? null : "Big Sur",
      pdfReady: false,
      sizeBytes: 10,
    };
  });

let routes: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>;
const calls: string[] = [];

beforeEach(() => {
  nav.reset("/");
  mockViewport(1440);
  calls.length = 0;
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      return key ? routes[key](url, init) : Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("ReportsView and ReportDetail", () => {
  it("lists reports with paging, deleted chats and both actions", async () => {
    routes["/api/reports?page="] = (url) => {
      const page = Number(new URL(url, "https://x").searchParams.get("page"));
      return Response.json({ items: reports(page), total: 13, page, pageSize: 12 });
    };
    const { container } = renderShell(<ReportsView page={1} />);
    expect(await screen.findByText("Showing 1–12 of 13")).toBeInTheDocument();
    expect(document.getElementById(`reports-row-${rid(2)}-chat`)).toHaveTextContent("From Chat deleted");
    expect(document.getElementById(`reports-row-${rid(1)}-open`)).toHaveAttribute("href", `/reports/${rid(1)}`);
    expect(document.getElementById(`reports-row-${rid(1)}-pdf`)).toHaveAttribute("href", `/api/artifacts/${rid(1)}?format=pdf`);
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(nav.push).toHaveBeenCalledWith("/reports?page=2");
    expectUniqueIds(container);
  });

  it("shows the empty and error states with Retry, and a 429 with its seconds", async () => {
    let fail = true;
    routes["/api/reports?page="] = () =>
      fail
        ? Response.json({ error: "rate_limited", retryAfter: 12 }, { status: 429 })
        : Response.json({ items: [], total: 0, page: 1, pageSize: 12 });
    renderShell(<ReportsView page={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load reports: Slow down: try again in 12 s.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No reports yet. Ask Juno/)).toBeInTheDocument();
  });

  it("loads the metadata before the sandboxed frame, and says when a report is missing", async () => {
    let resolve!: (r: Response) => void;
    routes[`/api/reports/${rid(1)}`] = () => new Promise((r) => (resolve = r));
    routes[`/api/reports/${rid(9)}`] = () => Response.json({ error: "not_found" }, { status: 404 });
    const { unmount } = renderShell(<ReportDetail reportId={rid(1)} />);
    expect(document.querySelector("iframe")).toBeNull();
    await act(async () => resolve(Response.json({ report: reports(1)[0] })));
    const frame = await waitFor(() => document.getElementById("report-detail-frame")!);
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect(screen.getByRole("link", { name: /From: Big Sur/ })).toHaveAttribute("href", `/chats/${CHAT}`);
    unmount();
    renderShell(<ReportDetail reportId={rid(9)} />);
    expect(await screen.findByText("This report doesn't exist or isn't yours.")).toBeInTheDocument();
  });
});

const trip = {
  kind: "plan",
  entity: "trip",
  id: "t1",
  version: 1,
  value: {
    destination: "Big Sur",
    start: "2026-11-14",
    end: "2026-11-16",
    travelers: 2,
    stays: [{ name: "Bad link", url: "javascript:alert(1)" }],
    days: [],
  },
};
const planSummary = {
  chatId: CHAT,
  chatTitle: "Big Sur",
  kind: "trip",
  entityId: "t1",
  key: "dDE",
  title: "Big Sur",
  line: "Big Sur, 2 travelers",
  version: 1,
  updatedAt: new Date().toISOString(),
};

describe("PlansView and PlanDetail", () => {
  it("shows counts on the filter, replaces the URL on filter and shows the filtered empty state", async () => {
    const counts = { cart: 0, trip: 1, event: 0, shortlist: 0, all: 1 };
    routes["/api/plans?"] = (url) => {
      const kind = new URL(url, "https://x").searchParams.get("kind");
      const items = kind === "cart" ? [] : [planSummary];
      return Response.json({ items, total: items.length, page: 1, pageSize: 12, counts });
    };
    const { rerender } = renderShell(<PlansView page={1} kind={null} />);
    expect(await screen.findByRole("radio", { name: "All · 1" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Trips · 1" })).toBeInTheDocument();
    expect(document.getElementById(`plans-row-${CHAT}-trip-dDE-view`)).toHaveAttribute("href", `/plans/${CHAT}/trip/dDE`);
    fireEvent.click(screen.getByRole("radio", { name: "Carts · 0" }));
    expect(nav.replace).toHaveBeenCalledWith("/plans?kind=cart");
    rerender(<PlansView page={1} kind="cart" />);
    expect(await screen.findByText(/No carts yet./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all plans" })).toBeInTheDocument();
  });

  it("renders a trip read-only with unsafe links as text, and explains 422 and 404", async () => {
    routes[`/api/plans/${CHAT}/trip/dDE`] = () => Response.json({ plan: planSummary, widget: trip });
    routes[`/api/plans/${CHAT}/trip/b2xk`] = () => Response.json({ error: "invalid_plan" }, { status: 422 });
    routes[`/api/plans/${CHAT}/trip/bm9wZQ`] = () => Response.json({ error: "not_found" }, { status: 404 });
    const { container, unmount } = renderShell(<PlanDetail chatId={CHAT} kind="trip" planKey="dDE" />);
    expect(await screen.findByText("To change this plan, open its chat.")).toBeInTheDocument();
    expect(container.querySelectorAll("input:not([disabled])")).toHaveLength(0);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText("Bad link").tagName).toBe("SPAN");
    expect(document.querySelector("[id^='plan-detail-trip-dDE']")).not.toBeNull();
    expectUniqueIds(container);
    unmount();
    const second = renderShell(<PlanDetail chatId={CHAT} kind="trip" planKey="b2xk" />);
    expect(await screen.findByText(/saved in an older shape/)).toBeInTheDocument();
    second.unmount();
    renderShell(<PlanDetail chatId={CHAT} kind="trip" planKey="bm9wZQ" />);
    expect(await screen.findByText("This plan doesn't exist or isn't yours.")).toBeInTheDocument();
  });
});

describe("SearchView and Highlight", () => {
  const response = (q: string) => ({
    items: [
      {
        kind: "chat",
        chatId: CHAT,
        title: "Weekend in Big Sur",
        at: "2026-10-31T10:00:00Z",
        match: "message",
        snippet: { text: "sunset at McWay Falls", truncatedStart: true, truncatedEnd: true },
      },
      { kind: "report", id: rid(1), title: "Big Sur guide", at: "2026-10-30T10:00:00Z", chatId: null, chatTitle: null },
    ],
    total: 2,
    page: 1,
    pageSize: 10,
    query: q,
    scope: "all",
    counts: { chats: 1, reports: 1 },
  });

  it("asks for three characters without a request", () => {
    renderShell(<SearchView q="ab" scope="all" page={1} />);
    expect(screen.getByText("Type at least 3 characters to search.")).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith("/api/search"))).toHaveLength(0);
  });

  it("shows hits with highlights, ellipses and scope counts; scope replaces the URL", async () => {
    routes["/api/search?"] = (url) => Response.json(response(new URL(url, "https://x").searchParams.get("q") ?? ""));
    nav.reset("/search?q=mcway");
    const { container } = renderShell(<SearchView q="mcway" scope="all" page={1} />);
    expect(await screen.findByText("Showing 1–2 of 2")).toBeInTheDocument();
    expect(container.querySelector("mark")).toHaveTextContent("McWay");
    expect(document.getElementById(`search-hit-chat-${CHAT}-snippet`)).toHaveTextContent("…sunset at McWay Falls…");
    expect(screen.getByRole("tab", { name: "Chats · 1" })).toBeInTheDocument();
    expect(document.getElementById(`search-hit-report-${rid(1)}-meta`)).toHaveTextContent("from Chat deleted");
    fireEvent.click(screen.getByRole("tab", { name: "Reports · 1" }));
    expect(nav.replace).toHaveBeenCalledWith("/search?q=mcway&scope=reports");
    expectUniqueIds(container);
  });

  it("aborts an older request and ignores its late answer", async () => {
    const signals: AbortSignal[] = [];
    routes["/api/search?"] = (url, init) => {
      signals.push(init?.signal as AbortSignal);
      const q = new URL(url, "https://x").searchParams.get("q") ?? "";
      return new Promise((r) =>
        setTimeout(
          () => r(Response.json({ ...response(q), items: [], total: q === "tacos" ? 0 : 5, counts: { chats: 0, reports: 0 } })),
          q === "taco" ? 50 : 0,
        ),
      );
    };
    const { rerender } = renderShell(<SearchView q="taco" scope="all" page={1} />);
    rerender(<SearchView q="tacos" scope="all" page={1} />);
    expect(signals[0].aborted).toBe(true);
    expect(await screen.findByText("No chats or reports match “tacos”.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByText("No chats or reports match “tacos”.")).toBeInTheDocument();
  });

  it("shows a search error with Retry", async () => {
    routes["/api/search?"] = () => Response.json({ error: "rate_limited", retryAfter: 7 }, { status: 429 });
    renderShell(<SearchView q="tacos" scope="all" page={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't search: Slow down: try again in 7 s.");
  });

  it("pushes the first keystroke from elsewhere and replaces later ones after a pause", async () => {
    vi.useFakeTimers();
    try {
      nav.reset("/reports");
      renderShell(<SearchView q="" scope="all" page={1} />);
      const box = document.getElementById("search-field-input") as HTMLInputElement;
      fireEvent.change(box, { target: { value: "t" } });
      expect(nav.push).toHaveBeenCalledWith("/search?q=t");
      await act(async () => nav.go("/search?q=t"));
      fireEvent.change(box, { target: { value: "ta" } });
      fireEvent.change(box, { target: { value: "tac" } });
      expect(nav.replace).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(260));
      expect(nav.replace).toHaveBeenCalledTimes(1);
      expect(nav.replace).toHaveBeenCalledWith("/search?q=tac");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps focus and every character when typing one key at a time in the search field", async () => {
    routes["/api/search?"] = (url) => Response.json(response(new URL(url, "https://x").searchParams.get("q") ?? ""));
    nav.reset("/search");
    const { rerender } = renderShell(<SearchView q="" scope="all" page={1} />);
    const box = document.getElementById("search-field-input") as HTMLInputElement;
    box.focus();
    const pause = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
    let typed = "";
    for (const ch of "mcway") {
      typed += ch;
      fireEvent.keyDown(box, { key: ch });
      fireEvent.change(box, { target: { value: typed } });
      fireEvent.keyUp(box, { key: ch });
      await pause(typed.length === 3 ? 300 : 20);
      const last = nav.replace.mock.calls.at(-1)?.[0] as string | undefined;
      if (last) rerender(<SearchView q={new URL(last, "https://x").searchParams.get("q") ?? ""} scope="all" page={1} />);
      expect(box).toHaveFocus();
      expect(box.value).toBe(typed);
    }
    expect(nav.replace).toHaveBeenCalledTimes(1);
    await pause(300);
    expect(nav.replace).toHaveBeenCalledTimes(2);
    expect(nav.replace).toHaveBeenLastCalledWith("/search?q=mcway");
    expect(nav.push).not.toHaveBeenCalled();
    expect(box).toHaveFocus();
  });

  it("moves between scope tabs with the arrow keys, Home and End", () => {
    nav.reset("/search?q=mcway");
    const { rerender } = renderShell(<SearchView q="mcway" scope="all" page={1} />);
    const tab = (name: string) => document.getElementById(`search-scopes-${name}`) as HTMLButtonElement;
    expect(tab("all")).toHaveAttribute("tabindex", "0");
    expect(tab("chats")).toHaveAttribute("tabindex", "-1");
    tab("all").focus();
    fireEvent.keyDown(tab("all"), { key: "ArrowRight" });
    expect(tab("chats")).toHaveFocus();
    expect(nav.replace).toHaveBeenLastCalledWith("/search?q=mcway&scope=chats");
    rerender(<SearchView q="mcway" scope="chats" page={1} />);
    expect(tab("chats")).toHaveAttribute("aria-selected", "true");
    expect(tab("chats")).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(tab("chats"), { key: "End" });
    expect(tab("reports")).toHaveFocus();
    expect(nav.replace).toHaveBeenLastCalledWith("/search?q=mcway&scope=reports");
    fireEvent.keyDown(tab("reports"), { key: "ArrowRight" });
    expect(tab("all")).toHaveFocus();
    expect(nav.replace).toHaveBeenLastCalledWith("/search?q=mcway");
    fireEvent.keyDown(tab("all"), { key: "ArrowLeft" });
    expect(tab("reports")).toHaveFocus();
    fireEvent.keyDown(tab("reports"), { key: "Home" });
    expect(tab("all")).toHaveFocus();
  });

  it("treats the query as literal text and never as a pattern or markup", () => {
    expect(highlightParts("A (a+)+$ b", "(a+)+$")).toEqual([
      { text: "A ", match: false },
      { text: "(a+)+$", match: true },
      { text: " b", match: false },
    ]);
    expect(
      highlightParts("x .* y", ".*")
        .filter((p) => p.match)
        .map((p) => p.text),
    ).toEqual([".*"]);
    expect(highlightParts("Big BIG big", "big").filter((p) => p.match)).toHaveLength(3);
    render(
      <p id="hl">
        {highlightParts("<b>bold</b>", "bold")
          .map((p) => p.text)
          .join("")}
      </p>,
    );
    expect(document.querySelector("#hl b")).toBeNull();
  });
});

describe("AgentSection and the empty state", () => {
  it("fills the name from chips, updates the heading live, explains bad names and sets look and tone", () => {
    const onChange = vi.fn();
    const onValidity = vi.fn();
    const { container } = render(<AgentSection scope="onboarding" agent={undefined} onChange={onChange} onValidity={onValidity} />);
    fireEvent.click(screen.getByRole("button", { name: "Sage" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi, I'm Sage.");
    expect(onChange).toHaveBeenLastCalledWith({ name: "Sage", look: "mist", tone: "warm" });
    fireEvent.change(screen.getByLabelText("Agent Name"), { target: { value: "<b>" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use letters, numbers, spaces, apostrophes, hyphens or periods.");
    expect(screen.getByLabelText("Agent Name")).toHaveAttribute("aria-invalid", "true");
    expect(onValidity).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Ember" }));
    expect(onChange).toHaveBeenLastCalledWith({ name: "Juno", look: "ember", tone: "warm" });
    expect(screen.getByRole("button", { name: "Mist" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Thorough" }));
    expect(onChange).toHaveBeenLastCalledWith({ name: "Juno", look: "mist", tone: "thorough" });
    expectUniqueIds(container);
  });

  it("shows the orb in the persona's look, the memory line and its fallback", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <EmptyState
        id="e"
        persona={{ ...DEFAULT_AGENT, look: "dusk" }}
        heading="h1"
        memory="Juno remembers your home in SLO."
        onOpenProfile={onOpen}
        onPick={() => {}}
      />,
    );
    expect(document.getElementById("e-orb")).toHaveAttribute("data-look", "dusk");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What should I look into?");
    expect(screen.getByText("Juno remembers your home in SLO.")).toBeInTheDocument();
    rerender(<EmptyState id="e" persona={DEFAULT_AGENT} heading="h2" memory={null} onOpenProfile={onOpen} onPick={() => {}} />);
    expect(screen.getByText(/about yourself in your profile/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open profile" }));
    expect(onOpen).toHaveBeenCalled();
  });
});
