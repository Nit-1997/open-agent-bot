import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivitySteps } from "@/components/chat/ActivitySteps";
import { Markdown } from "@/components/chat/Markdown";
import { RecentChats } from "@/components/chat/RecentChats";
import { SourcesRow } from "@/components/chat/SourcesRow";
import { AccessDisabled, SignedOutBanner } from "@/components/SessionNotices";
import { noteAuthFailure, resetAuthState, useAuthState } from "@/lib/authState";
import type { Step } from "@/lib/turns";

const htmlIds = (root: HTMLElement) =>
  [...root.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);

const expectUniqueIds = (root: HTMLElement) => {
  const ids = htmlIds(root);
  expect(ids.filter((id) => !id)).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
};

describe("Markdown", () => {
  it("gives every element a unique id and opens links in a new tab", () => {
    const { container } = render(
      <Markdown id="m1" text={"# Plan\n\n- **one** [Target](https://target.com)\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />,
    );
    const ids = htmlIds(container);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getByRole("link", { name: "Target" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("drops images the model writes", () => {
    const { container } = render(<Markdown id="m2" text="![x](https://tracker.example/p.gif)" />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("SourcesRow", () => {
  const sources = [
    { url: "https://target.com/a", title: "Target diyas", host: "target.com" },
    { url: "https://walmart.com/b", title: "Walmart lanterns", host: "walmart.com" },
  ];

  it("shows a compact count and expands into the list", () => {
    render(<SourcesRow id="s1" sources={sources} />);
    expect(screen.queryByRole("link", { name: /Target diyas/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2 sources/ }));
    expect(screen.getByRole("link", { name: /Target diyas/ })).toHaveAttribute("href", "https://target.com/a");
  });

  it("renders nothing without sources", () => {
    const { container } = render(<SourcesRow id="s2" sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ActivitySteps", () => {
  const steps: Step[] = [
    { id: "a", name: "web_search", args: { query: "diyas" }, done: true, sites: ["target.com"] },
    { id: "b", name: "fetch_page", args: { url: "https://walmart.com/x" }, done: false, sites: [] },
  ];

  it("shows the live step while running", () => {
    render(<ActivitySteps id="a1" steps={steps} running startedAt={0} now={5000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading walmart.com");
    expect(screen.getByText("5s")).toBeInTheDocument();
  });

  it("collapses to a summary when done and expands to the steps", () => {
    render(
      <ActivitySteps id="a2" steps={steps.map((s) => ({ ...s, done: true }))} running={false} startedAt={0} endedAt={12000} now={0} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Worked for 12s");
    expect(screen.getByText("1 search · 1 page read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Worked for 12s/ }));
    expect(screen.getByText("Searched “diyas”")).toBeInTheDocument();
    expect(screen.getByText("Read walmart.com")).toBeInTheDocument();
  });

  it("says it's thinking before any step starts", () => {
    render(<ActivitySteps id="a3" steps={[]} running now={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
  });
});

const chatId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const chats = (page: number) =>
  Array.from({ length: Math.min(5, 16 - (page - 1) * 5) }, (_, i) => {
    const n = (page - 1) * 5 + i + 1;
    return { id: chatId(n), title: n === 7 ? "" : `Chat ${n}`, lastMessageAt: "2026-10-31T10:00:00Z" };
  });

describe("RecentChats", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(over: { failPage?: boolean; failMessages?: boolean } = {}) {
    const fetchMock = vi.fn(async (url: string) => {
      const page = /page=(\d+)/.exec(url);
      if (page) {
        if (over.failPage) return Response.json({ error: "rate_limited", retryAfter: 12 }, { status: 429 });
        const n = Number(page[1]);
        return Response.json({ items: chats(n), total: 16, page: n, pageSize: 5 });
      }
      if (over.failMessages) return Response.json({ error: "not_found", message: "This chat doesn't exist." }, { status: 404 });
      return Response.json({
        items: [
          { role: "user", content: "price eggs", status: "complete", createdAt: "x" },
          { role: "assistant", content: "Eggs are", status: "interrupted", createdAt: "y" },
        ],
        total: 2,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("pages through chats newest first with unique ids", async () => {
    stub();
    const { container } = render(<RecentChats currentThreadId={chatId(2)} onOpen={() => {}} />);
    expect(await screen.findByText("Showing 1–5 of 16")).toBeInTheDocument();
    expect(screen.getByText("(current)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Showing 6–10 of 16")).toBeInTheDocument();
    fireEvent.click(document.getElementById(`recent-chats-view-${chatId(7)}`) as HTMLElement);
    expect(screen.getAllByText("Untitled chat").length).toBeGreaterThan(1);
    expectUniqueIds(container);
  });

  it("opens a chat with its messages, marking stopped replies", async () => {
    stub();
    const onOpen = vi.fn();
    render(<RecentChats currentThreadId="other" onOpen={onOpen} />);
    await screen.findByText("Showing 1–5 of 16");
    fireEvent.click(document.getElementById(`recent-chats-open-${chatId(1)}`) as HTMLElement);
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    const [id, history] = onOpen.mock.calls[0];
    expect(id).toBe(chatId(1));
    expect(history).toEqual([
      { id: `history-${chatId(1)}-0`, role: "user", content: "price eggs" },
      { id: `history-${chatId(1)}-1`, role: "assistant", content: "Eggs are\n\n(stopped)" },
    ]);
  });

  it("shows the agent's error on the row when a chat can't be opened", async () => {
    stub({ failMessages: true });
    const onOpen = vi.fn();
    const { container } = render(<RecentChats currentThreadId="other" onOpen={onOpen} />);
    await screen.findByText("Showing 1–5 of 16");
    fireEvent.click(document.getElementById(`recent-chats-open-${chatId(3)}`) as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open this chat: This chat doesn't exist.");
    expect(onOpen).not.toHaveBeenCalled();
    expectUniqueIds(container);
  });

  it("explains a failed load and retries on request", async () => {
    const fetchMock = stub({ failPage: true });
    const { container } = render(<RecentChats currentThreadId="other" onOpen={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load chats: Slow down: try again in 12 s.");
    expectUniqueIds(container);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

function AuthProbe() {
  return <p id="probe">{useAuthState()}</p>;
}

describe("session notices", () => {
  afterEach(() => resetAuthState());

  it("render unique ids", () => {
    const { container } = render(
      <>
        <SignedOutBanner />
        <AccessDisabled />
      </>,
    );
    expectUniqueIds(container);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByText("Your access has been turned off.")).toBeInTheDocument();
  });

  it("tracks signed_out and account_disabled from API answers, and never downgrades disabled", () => {
    render(<AuthProbe />);
    act(() => noteAuthFailure(401, "unauthorized"));
    expect(screen.getByText("active")).toBeInTheDocument();
    act(() => noteAuthFailure(401, "signed_out"));
    expect(screen.getByText("signed_out")).toBeInTheDocument();
    act(() => noteAuthFailure(403, "account_disabled"));
    act(() => noteAuthFailure(401, "signed_out"));
    expect(screen.getByText("account_disabled")).toBeInTheDocument();
  });
});
