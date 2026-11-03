import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchView } from "@/components/search/SearchView";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { useShell } from "@/components/shell/ShellProvider";
import { chatIndex } from "@/lib/chatIndex";
import { composerInputId } from "@/lib/shell/chatController";
import { copilot } from "../support/copilot";
import { mockViewport } from "../support/media";
import { flush, nav, renderShell } from "../support/shell";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());
vi.mock("@copilotkit/react-core/v2", async () => (await import("../support/copilot")).copilotMock());

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  copilot.reset();
  chatIndex.reset();
  nav.reset("/");
  mockViewport(1440);
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const chat = /^\/api\/chats\/([0-9a-f-]{36})(\/messages)?$/.exec(url);
      if (chat?.[2]) return Response.json({ items: [{ role: "user", content: "hello a", status: "complete", createdAt: "x" }], total: 1 });
      if (chat) return Response.json({ chat: { id: chat[1], title: "Chat a", lastMessageAt: new Date().toISOString() } });
      if (url.startsWith("/api/chats?")) return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
      if (url.startsWith("/api/search?")) return new Promise(() => {});
      return Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const go = async (path: string) => {
  await act(async () => nav.go(path));
  await flush();
};
const byId = (id: string) => document.getElementById(id) as HTMLElement;

function Routed() {
  const pathname = usePathname();
  const params = useSearchParams();
  return pathname === "/search" ? <SearchView q={params.get("q") ?? ""} scope="all" page={1} /> : null;
}

const shellRef: { current: ReturnType<typeof useShell> | null } = { current: null };
function Probe() {
  const shell = useShell();
  useEffect(() => {
    shellRef.current = shell;
  });
  return null;
}

describe("focus requests", () => {
  it("a New chat on an untouched draft focuses its composer and leaves no request for a later chat", async () => {
    renderShell(
      <ShellFrame>
        <Probe />
      </ShellFrame>,
    );
    await go(`/chats/${A}`);
    await screen.findByText("hello a");
    const input = byId(composerInputId(A)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "keep running" } });
    fireEvent.submit(input.closest("form")!);
    await flush();
    await go("/");
    const draft = shellRef.current!.chats.activeId;
    fireEvent.click(byId("sidebar-new-chat"));
    expect(byId(composerInputId(draft))).toHaveFocus();
    byId("sidebar-search-input").focus();
    await go(`/chats/${A}`);
    expect(byId(`chat-pane-${A}`)).not.toHaveAttribute("hidden");
    expect(byId("sidebar-search-input")).toHaveFocus();
  });

  it("rail Search on /search focuses the field now and doesn't steal focus from the sidebar later", async () => {
    nav.reset("/search");
    renderShell(
      <ShellFrame>
        <Routed />
      </ShellFrame>,
    );
    await flush();
    fireEvent.click(byId("rail-search"));
    await flush();
    expect(byId("search-field-input")).toHaveFocus();
    await go("/reports");
    expect(byId("search-field")).toBeNull();
    const sidebar = byId("sidebar-search-input");
    sidebar.focus();
    fireEvent.change(sidebar, { target: { value: "t" } });
    await flush();
    expect(nav.pathname).toBe("/search");
    expect(byId("search-field-input")).not.toBeNull();
    expect(sidebar).toHaveFocus();
  });

  it("a request is dropped when the user goes somewhere else first", async () => {
    nav.reset("/reports");
    renderShell(
      <ShellFrame>
        <Probe />
        <Routed />
      </ShellFrame>,
    );
    await flush();
    act(() => shellRef.current!.requestFocus("search"));
    await go("/chats");
    const sidebar = byId("sidebar-search-input");
    sidebar.focus();
    await go("/search?q=ta");
    expect(sidebar).toHaveFocus();
  });

  it("rail Search from another section focuses the search field once it opens", async () => {
    nav.reset("/reports");
    renderShell(
      <ShellFrame>
        <Routed />
      </ShellFrame>,
    );
    await flush();
    fireEvent.click(byId("rail-search"));
    await flush();
    expect(byId("search-field-input")).toHaveFocus();
  });
});

describe("breakpoint overlays", () => {
  it("closes the tablet sidebar overlay when the breakpoint changes and doesn't bring it back", async () => {
    const vp = mockViewport(900);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await flush();
    const toggle = byId("rail-sidebar-toggle");
    toggle.focus();
    fireEvent.click(toggle);
    expect(byId("sidebar-overlay")).not.toBeNull();
    await act(async () => vp.resize(1440));
    await act(async () => vp.resize(900));
    expect(byId("sidebar-overlay")).toBeNull();
    const reopen = byId("rail-sidebar-toggle");
    expect(reopen).toHaveAttribute("aria-expanded", "false");
    reopen.focus();
    fireEvent.click(reopen);
    expect(byId("sidebar-overlay")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(byId("sidebar-overlay")).toBeNull();
    await waitFor(() => expect(reopen).toHaveFocus());
  });
});
