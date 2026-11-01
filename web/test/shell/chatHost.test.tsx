import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { chatIndex } from "@/lib/chatIndex";
import { copilot } from "../support/copilot";
import { expectUniqueIds } from "../support/ids";
import { mockViewport } from "../support/media";
import { flush, nav, renderShell } from "../support/shell";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());
vi.mock("@copilotkit/react-core/v2", async () => (await import("../support/copilot")).copilotMock());

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

beforeEach(() => {
  copilot.reset();
  chatIndex.reset();
  nav.reset("/");
  mockViewport(1440);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const chat = /^\/api\/chats\/([0-9a-f-]{36})(\/messages)?$/.exec(url);
      if (chat?.[1] === D) return Response.json({ error: "not_found", message: "This chat doesn't exist." }, { status: 404 });
      if (chat?.[2])
        return Response.json({
          items: [{ role: "user", content: `hello ${chat[1].slice(0, 1)}`, status: "complete", createdAt: "x" }],
          total: 1,
        });
      if (chat)
        return Response.json({ chat: { id: chat[1], title: `Chat ${chat[1].slice(0, 1)}`, lastMessageAt: new Date().toISOString() } });
      if (url.startsWith("/api/chats?")) return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
      return Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const go = async (path: string) => {
  await act(async () => nav.go(path));
  await flush();
};
const panes = () => [...document.querySelectorAll("#chat-host > section")];
const agentOf = (id: string) => copilot.agents.get(`chat-${id}`)!;

async function startRun(threadId: string) {
  const input = document.getElementById(`chat-pane-${threadId}-composer-input`) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: `message for ${threadId}` } });
  fireEvent.submit(input.closest("form")!);
  await flush();
}

describe("ChatHost", () => {
  it("hides the chat off chat routes without unmounting it", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await go(`/chats/${A}`);
    const pane = await waitFor(() => document.getElementById(`chat-pane-${A}`)!);
    await go("/reports");
    expect(document.getElementById("chat-host")).toHaveAttribute("hidden");
    expect(document.getElementById("chat-host")).toHaveAttribute("inert");
    expect(document.getElementById(`chat-pane-${A}`)).toBe(pane);
  });

  it("keeps a running hidden chat mounted, unmounts it after the run, and never mounts more than three", async () => {
    const { container } = renderShell(<ShellFrame>{null}</ShellFrame>);
    for (const id of [A, B]) {
      await go(`/chats/${id}`);
      await screen.findByText(`hello ${id.slice(0, 1)}`);
      await startRun(id);
    }
    await go(`/chats/${C}`);
    await screen.findByText("hello c");
    expect(panes().map((p) => p.id)).toEqual([`chat-pane-${C}`, `chat-pane-${A}`, `chat-pane-${B}`]);
    expect(document.getElementById(`chat-pane-${A}`)).toHaveAttribute("hidden");
    expectUniqueIds(container);
    for (const id of [A, B, C]) {
      const label = document.getElementById(`chat-pane-${id}-composer-label`)!;
      expect(label.getAttribute("for")).toBe(`chat-pane-${id}-composer-input`);
    }
    await act(async () => copilot.runs.find((r) => r.agent === agentOf(A))!.finish());
    await flush();
    expect(panes().map((p) => p.id)).toEqual([`chat-pane-${C}`, `chat-pane-${B}`]);
  });

  it("moves a new chat's URL to /chats/<id> on the first non-error run event, not on send", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await flush();
    const draft = panes()[0].id.replace("chat-pane-", "");
    await startRun(draft);
    expect(replace).not.toHaveBeenCalled();
    act(() => agentOf(draft).emit("RUN_STARTED"));
    act(() => agentOf(draft).emit("RUN_ERROR"));
    expect(replace).not.toHaveBeenCalled();
    act(() => agentOf(draft).emit("RUN_STARTED"));
    act(() => agentOf(draft).emit("TEXT_MESSAGE_START"));
    expect(replace).toHaveBeenCalledWith(null, "", `/chats/${draft}`);
    expect(chatIndex.get().items[0]).toMatchObject({ id: draft, title: `message for ${draft}`.slice(0, 80) });
    replace.mockRestore();
  });

  it("shows ChatMissing for a chat that isn't the user's", async () => {
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await go(`/chats/${D}`);
    expect(await screen.findByText("This chat doesn't exist or isn't yours.")).toBeInTheDocument();
  });
});

describe("ShellFrame", () => {
  it("keeps the same chat pane and its typed text across the 1024 and 768 px breakpoints", async () => {
    const vp = mockViewport(1440);
    renderShell(<ShellFrame>{null}</ShellFrame>);
    await go(`/chats/${A}`);
    await screen.findByText("hello a");
    const pane = document.getElementById(`chat-pane-${A}`);
    const input = document.getElementById(`chat-pane-${A}-composer-input`) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "keep me" } });
    expect(document.getElementById("rail")).not.toBeNull();
    await act(async () => vp.resize(900));
    expect(document.getElementById("sidebar")).toBeNull();
    expect(document.getElementById("rail")).not.toBeNull();
    await act(async () => vp.resize(390));
    expect(document.getElementById("rail")).toBeNull();
    expect(document.getElementById("mobile-tabs")).not.toBeNull();
    expect(document.getElementById(`chat-pane-${A}`)).toBe(pane);
    expect((document.getElementById(`chat-pane-${A}-composer-input`) as HTMLTextAreaElement).value).toBe("keep me");
    await act(async () => vp.resize(1440));
    expect(document.getElementById(`chat-pane-${A}`)).toBe(pane);
  });
});
