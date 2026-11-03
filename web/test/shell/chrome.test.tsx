import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCard } from "@/components/shell/AgentCard";
import { MobileTabs } from "@/components/shell/MobileTabs";
import { MobileTopBar } from "@/components/shell/MobileTopBar";
import { Rail } from "@/components/shell/Rail";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { ChatList } from "@/components/chat/ChatList";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { useShell } from "@/components/shell/ShellProvider";
import { DEFAULT_AGENT } from "@oab/shared/profile";
import { parseRoute } from "@oab/shared/routes";
import MissingPage from "@/app/(app)/[...missing]/page";
import ShellNotFound from "@/app/(app)/not-found";
import { chatIndex } from "@/lib/chatIndex";
import { render } from "@testing-library/react";
import { copilot } from "../support/copilot";
import { expectUniqueIds } from "../support/ids";
import { mockViewport } from "../support/media";
import { nav } from "../support/navigation";
import { flush, profile, renderShell } from "../support/shell";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());
vi.mock("@copilotkit/react-core/v2", async () => (await import("../support/copilot")).copilotMock());

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY = 86_400_000;

function chatsFixture(total: number, failPage?: number) {
  return vi.fn(async (url: string) => {
    const m = /^\/api\/chats\?page=(\d+)$/.exec(url);
    if (m) {
      const page = Number(m[1]);
      if (page === failPage) return Response.json({ error: "rate_limited", retryAfter: 12 }, { status: 429 });
      const items = Array.from({ length: Math.max(0, Math.min(20, total - (page - 1) * 20)) }, (_, i) => {
        const n = (page - 1) * 20 + i + 1;
        return { id: id(n), title: n === 3 ? "" : `Chat ${n}`, lastMessageAt: new Date(Date.now() - n * DAY * 0.6).toISOString() };
      });
      return Response.json({ items, total, page, pageSize: 20 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
}

beforeEach(() => {
  copilot.reset();
  chatIndex.reset();
  nav.reset("/");
  mockViewport(1440);
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function RailHost() {
  const { sidebar } = useShell();
  return <Rail sidebarOpen={sidebar.open} onToggleSidebar={sidebar.toggle} showNewChat={!sidebar.open} />;
}

describe("Rail", () => {
  it("marks the current section, collapses and persists, and shows New chat only when collapsed", async () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    nav.reset("/reports");
    const { container } = renderShell(<RailHost />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Chats" })).not.toHaveAttribute("aria-current");
    expect(document.getElementById("rail-plans")).toBeNull();
    expect(screen.queryByRole("link", { name: /Plans/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("oa.sidebar")).toBe("collapsed");
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expectUniqueIds(container);
  });

  it("opens the account menu upward with focus on the first item and full keyboard support", async () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    renderShell(<RailHost />);
    const button = screen.getByRole("button", { name: "Account: Nitin Bhat" });
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("bottom-0");
    expect(menu.className).toContain("left-full");
    expect(screen.getByRole("menuitem", { name: "Profile & settings" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /Juno, your agent/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Profile & settings" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    expect(screen.queryByRole("menuitem", { name: "Admin" })).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("toggles the theme from the account menu and keeps the menu open", () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    renderShell(<RailHost />);
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));
    const item = screen.getByRole("menuitemcheckbox", { name: "Dark theme" });
    expect(item).toHaveAttribute("aria-checked", "false");
    fireEvent.click(item);
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(item).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("opens the profile drawer at the agent group from the menu", async () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    renderShell(<RailHost />);
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Juno, your agent/ }));
    await waitFor(() => expect(screen.getByLabelText("Agent Name")).toHaveFocus());
  });

  it("shows a working dot when a hidden chat runs", async () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    function Runner() {
      const { dispatch, chats } = useShell();
      return (
        <button id="run" type="button" onClick={() => dispatch({ type: "running", id: chats.activeId, running: true })}>
          run
        </button>
      );
    }
    nav.reset("/reports");
    renderShell(
      <>
        <RailHost />
        <Runner />
      </>,
    );
    expect(document.getElementById("rail-chats-dot")).toBeNull();
    fireEvent.click(screen.getByText("run"));
    expect(document.getElementById("rail-chats-dot")).not.toBeNull();
    expect(screen.getByText("(Juno is working)")).toHaveClass("sr-only");
  });

  it("shows the Admin item only for admins", () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    renderShell(<RailHost />);
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));
    expect(screen.queryByRole("menuitem", { name: "Admin" })).toBeNull();
  });
});

describe("ChatList", () => {
  it("groups newest first, marks the active chat, shows 20 of 24 and appends the next page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15, 23, 0));
    vi.stubGlobal("fetch", chatsFixture(24));
    nav.reset(`/chats/${id(2)}`);
    const { container } = renderShell(<ChatList id="chat-list-sidebar" variant="sidebar" />);
    expect(await screen.findByText("Showing 20 of 24")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Today", "This week", "Earlier"]);
    expect(document.getElementById(`chat-list-sidebar-row-${id(2)}`)).toHaveAttribute("aria-current", "page");
    expect(document.getElementById(`chat-list-sidebar-row-${id(3)}`)).toHaveTextContent("Untitled chat");
    const titles = [...container.querySelectorAll("a")].map((a) => a.textContent);
    expect(titles.slice(0, 2)).toEqual(["Chat 1", "Chat 2"]);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Showing 24 of 24")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expectUniqueIds(container);
  });

  it("keeps page 1 when page 2 fails and shows the error under it", async () => {
    vi.stubGlobal("fetch", chatsFixture(24, 2));
    renderShell(<ChatList id="chat-list-sidebar" variant="sidebar" />);
    await screen.findByText("Showing 20 of 24");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load chats: Slow down: try again in 12 s.");
    expect(screen.getByText("Showing 20 of 24")).toBeInTheDocument();
  });

  it("has distinct loading, empty and error states", async () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    const { unmount } = renderShell(<ChatList id="chat-list-sidebar" variant="sidebar" />);
    expect(document.getElementById("chat-list-sidebar-state")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText("No chats yet. Start one with New chat.")).toBeInTheDocument();
    unmount();
    chatIndex.reset();
    vi.stubGlobal("fetch", chatsFixture(5, 1));
    renderShell(<ChatList id="chat-list-sidebar" variant="sidebar" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load chats");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("drawer shows five rows and Show all N chats, hidden at five or fewer", async () => {
    vi.stubGlobal("fetch", chatsFixture(16));
    const { unmount } = renderShell(<ChatList id="chat-list-drawer" variant="drawer" />);
    expect(await screen.findByRole("link", { name: "Show all 16 chats" })).toHaveAttribute("href", "/chats");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    unmount();
    chatIndex.reset();
    vi.stubGlobal("fetch", chatsFixture(5));
    renderShell(<ChatList id="chat-list-drawer" variant="drawer" />);
    await screen.findByText("Chat 5");
    expect(screen.queryByRole("link", { name: /Show all/ })).toBeNull();
  });
});

describe("AgentCard", () => {
  it("shows the name and what it knows, and opens the drawer at the agent group", async () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    renderShell(<AgentCard id="agent-card" />, {
      profile: profile({ agent: { name: "Sage", look: "ember" }, home: { label: "SLO", city: "SLO" }, food: ["Vegetarian"] }),
    });
    expect(screen.getByText("Sage")).toBeInTheDocument();
    expect(screen.getByText("Your agent · knows SLO, vegetarian")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sage/ }));
    await waitFor(() => expect(screen.getByLabelText("Agent Name")).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "Profile" })).toBeInTheDocument();
  });

  it("asks to be told about you when the profile is empty", () => {
    vi.stubGlobal("fetch", chatsFixture(0));
    renderShell(<AgentCard id="agent-card" />);
    expect(screen.getByText("Your agent · tell it about you")).toBeInTheDocument();
  });
});

describe("ChatHeader", () => {
  it("shows the title, Untitled chat, and the working line only while running", () => {
    const { rerender } = render(<ChatHeader id="h" title="" running={false} persona={DEFAULT_AGENT} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Untitled chat");
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<ChatHeader id="h" title="Big Sur" running persona={{ ...DEFAULT_AGENT, name: "Sage" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sage is working on this");
  });
});

describe("removed Plans section", () => {
  it("falls through to the shell's not-found page", () => {
    expect(parseRoute("/plans")).toBeNull();
    expect(parseRoute("/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/trip/dDE")).toBeNull();
    expect(() => MissingPage()).toThrow("notFound");
    render(<ShellNotFound />);
    expect(document.getElementById("shell-not-found-title")).toHaveTextContent("This page doesn't exist.");
  });
});

describe("phone chrome", () => {
  it("top bar shows the agent on chat routes and the section title elsewhere; tabs mark the current page; You opens the sheet", async () => {
    mockViewport(390);
    vi.stubGlobal("fetch", chatsFixture(0));
    const { container } = renderShell(
      <>
        <MobileTopBar />
        <MobileTabs />
      </>,
      { profile: profile({ agent: { name: "Milo" } }) },
    );
    expect(document.getElementById("mobile-topbar-name")).toHaveTextContent("Milo");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    await act(async () => nav.go("/reports"));
    expect(document.getElementById("mobile-topbar-title")).toHaveTextContent("Reports");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
    const tabs = document.getElementById("mobile-tabs")!;
    expect([...tabs.children].map((t) => t.textContent)).toEqual(["Chat", "Search", "Reports", expect.stringMatching(/You$/)]);
    expect(document.getElementById("mobile-tabs-plans")).toBeNull();
    await act(async () => nav.go("/search"));
    expect(document.getElementById("mobile-tabs-search")).toHaveAttribute("aria-current", "page");
    expect(document.getElementById("mobile-tabs-reports")).not.toHaveAttribute("aria-current");
    expectUniqueIds(container);
    const you = screen.getByRole("button", { name: /You/ });
    fireEvent.click(you);
    expect(screen.getByRole("dialog", { name: "Account" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Account" })).getByRole("switch", { name: "Dark theme" })).toBeInTheDocument();
  });

  it("drawer: focus starts on close, Tab stays inside, Escape and backdrop close and return focus, links close it, Models opens the panel", async () => {
    mockViewport(390);
    vi.stubGlobal("fetch", chatsFixture(16));
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await flush();
    const menu = screen.getByRole("button", { name: "Open chats" });
    menu.focus();
    fireEvent.click(menu);
    const close = await screen.findByRole("button", { name: "Close chats" });
    expect(close).toHaveFocus();
    expect(document.getElementById("shell-frame")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    const dialog = screen.getByRole("dialog", { name: "Chats" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull();
    await waitFor(() => expect(menu).toHaveFocus());
    fireEvent.click(menu);
    fireEvent.click(document.getElementById("mobile-drawer-backdrop")!);
    expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull();
    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole("link", { name: "Show all 16 chats" }));
    expect(nav.pathname).toBe("/chats");
    expect(screen.queryByRole("dialog", { name: "Chats" })).toBeNull();
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));
    expect(screen.getByRole("dialog", { name: "Models" })).toBeInTheDocument();
  });
});
