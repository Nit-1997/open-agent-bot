import { DEFAULT_AGENT, emptyProfile, type Profile } from "@oab/shared/profile";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSession } from "../src/components/chat/ChatSession.tsx";
import { ChatsView } from "../src/components/chat/ChatsView.tsx";
import { ReportDetail } from "../src/components/reports/ReportDetail.tsx";
import { ReportRow } from "../src/components/reports/ReportRow.tsx";
import { ReportsView } from "../src/components/reports/ReportsView.tsx";
import { SearchView } from "../src/components/search/SearchView.tsx";
import { AppShell } from "../src/components/shell/AppShell.tsx";
import { ShellFrame } from "../src/components/shell/ShellFrame.tsx";
import { WidgetRenderer } from "../src/components/widgets/WidgetRenderer.tsx";
import { noteAuthFailure, resetAuthState } from "../src/lib/authState.ts";
import { chatIndex } from "../src/lib/chatIndex.ts";
import { resetProfileStore } from "../src/lib/profile.ts";
import { WIDGET_GALLERY } from "./fixtures/widgetGallery.ts";
import { copilot } from "./support/copilot.ts";
import { expectUniqueIds } from "./support/ids.ts";
import { mockViewport } from "./support/media.ts";
import { nav, syncHistory } from "./support/navigation.tsx";
import { shellPlatform, withPlatform } from "./support/platform.tsx";
import { renderShell } from "./support/shell.tsx";

vi.mock("@copilotkit/react-core/v2", async () => (await import("./support/copilot.ts")).copilotMock());

const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const chatId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const reportId = (n: number) => `report${String(n).padStart(6, "0")}`;
const HOUR = 3_600_000;
const NOW = Date.now();

const onboarded = (): Profile => ({ ...emptyProfile(), name: "Nitin Bhat", onboardedAt: "2026-10-30" });

const chats = Array.from({ length: 7 }, (_, i) => ({
  id: chatId(i + 1),
  title: i === 2 ? "" : `Chat ${i + 1}`,
  lastMessageAt: new Date(NOW - (i * 19 + 2) * HOUR).toISOString(),
}));

const report = (n: number) => ({
  id: reportId(n),
  title: `Report ${n}`,
  createdAt: new Date(NOW - n * 30 * HOUR).toISOString(),
  chatId: n === 2 ? null : CHAT,
  chatTitle: n === 2 ? null : "Big Sur",
  pdfReady: n === 1,
  sizeBytes: 1024 * n,
});

const providers = [
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "cloud",
    site: "openrouter.ai",
    methods: ["api_key"],
    configured: true,
    source: "key",
    enabled: ["deepseek/deepseek-v4-flash"],
    modelCount: 300,
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    site: "openai.com",
    keyUrl: "https://platform.openai.com/api-keys",
    methods: ["api_key", "oauth"],
    oauthLabel: "Sign in with ChatGPT",
    configured: false,
    enabled: [],
    modelCount: 40,
  },
  {
    id: "ollama",
    label: "Ollama",
    kind: "local",
    site: "ollama.com",
    methods: [],
    defaultBaseUrl: "http://host.docker.internal:11434/v1",
    configured: false,
    enabled: [],
    modelCount: 0,
  },
];

const options = {
  country: "US",
  currency: "USD",
  units: "imperial",
  airports: ["OAK", "SFO", "SJC"],
  groceriesNearby: true,
  rows: {
    airlines: ["Southwest", "United"],
    hotelChains: ["Marriott", "Independent"],
    sites: [
      { label: "Google Flights", access: "searched" },
      { label: "Expedia", access: "linked" },
    ],
    groceries: ["Trader Joe's", "Safeway"],
    retail: ["Amazon", "Target"],
    delivery: ["Instacart", "DoorDash"],
  },
};

const searchBody = {
  items: [
    {
      kind: "chat",
      chatId: CHAT,
      title: "Weekend in Big Sur",
      at: new Date(NOW - 5 * HOUR).toISOString(),
      match: "message",
      snippet: { text: "sunset at McWay Falls", truncatedStart: true, truncatedEnd: true },
    },
    { kind: "chat", chatId: chatId(1), title: "McWay hike", at: new Date(NOW - 50 * HOUR).toISOString(), match: "title" },
    {
      kind: "report",
      id: reportId(1),
      title: "Big Sur guide",
      at: new Date(NOW - 80 * HOUR).toISOString(),
      chatId: CHAT,
      chatTitle: "Big Sur",
    },
  ],
  total: 3,
  page: 1,
  pageSize: 10,
  query: "mcway",
  scope: "all",
  counts: { chats: 2, reports: 1 },
};

const SEARCH_RESULT =
  "1. McWay Falls trail — https://www.parks.ca.gov/mcway\n2. Big Sur lodging — https://www.bigsurcalifornia.org/lodging";

const artifactTool = (id: string, title: string) => ({
  type: "tool",
  id: `c-${id}`,
  name: "create_artifact",
  args: JSON.stringify({ title }),
  result: `artifact ${id} created: ${title}`,
});

const history = [
  { role: "user", content: "plan big sur", status: "complete", createdAt: "x" },
  {
    role: "assistant",
    content: "Here are two reports.",
    status: "complete",
    createdAt: "x",
    parts: [artifactTool(reportId(1), "Report 1"), artifactTool(reportId(3), "Report 3"), { type: "text", text: "Here are two reports." }],
  },
];

let profileBody: Profile;

function respond(url: string): Response {
  const path = url.split("?")[0];
  const chat = /^\/api\/chats\/([0-9a-f-]{36})(\/messages)?$/.exec(path);
  if (chat?.[2]) return Response.json({ items: chat[1] === CHAT ? history : [], total: 2 });
  if (chat) return Response.json({ chat: { id: chat[1], title: "Big Sur", lastMessageAt: new Date(NOW).toISOString() } });
  if (path === "/api/profile") return Response.json({ profile: profileBody });
  if (path === "/api/models")
    return Response.json({
      default: "openrouter/deepseek/deepseek-v4-flash",
      models: [
        { id: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "OpenRouter", note: "$0.09 in" },
        { id: "openrouter/anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "OpenRouter" },
      ],
    });
  if (path === "/api/chats") return Response.json({ items: chats, total: chats.length, page: 1, pageSize: 20 });
  if (path === "/api/reports") return Response.json({ items: [1, 2, 3].map(report), total: 3, page: 1, pageSize: 12 });
  const rep = /^\/api\/reports\/(report\d{6})$/.exec(path);
  if (rep) return Response.json({ report: report(Number(rep[1].slice(-6))) });
  if (path === "/api/search") return Response.json(searchBody);
  if (path === "/api/providers") return Response.json({ providers });
  if (path === "/api/settings") return Response.json({ braveSearch: false });
  if (path === "/api/onboarding/options") return Response.json(options);
  return Response.json({ error: "not_found" }, { status: 404 });
}

beforeEach(() => {
  profileBody = onboarded();
  copilot.reset();
  chatIndex.reset();
  resetProfileStore();
  resetAuthState();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  mockViewport(1440);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => respond(url)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAuthState();
});

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => {});
}

const click = async (id: string) => {
  await act(async () => {
    fireEvent.click(document.getElementById(id)!);
  });
};

async function show(ui: ReactNode, path: string, ready: string, after?: () => Promise<void>, opts: { isAdmin?: boolean } = {}) {
  nav.reset(path);
  const { container } = render(withPlatform(ui, shellPlatform(opts)));
  await waitFor(() => expect(document.querySelector(ready)).not.toBeNull());
  await settle();
  if (after) {
    await after();
    await settle();
  }
  return container;
}

const shell = (children: ReactNode = null) => <AppShell>{children}</AppShell>;

const openFromMenu = (item: string, ready: string) => async () => {
  await click("account-menu-button");
  await click(item);
  await waitFor(() => expect(document.getElementById(ready)).not.toBeNull());
};

type View = Readonly<{ name: string; run: () => Promise<HTMLElement> }>;

const views: View[] = [
  {
    name: "app shell with the account menu",
    run: () => show(shell(), "/", "#chat-list-sidebar-groups li", () => click("account-menu-button")),
  },
  {
    name: "app shell with the admin account menu",
    run: () => show(shell(), "/", "#chat-list-sidebar-groups li", () => click("account-menu-button"), { isAdmin: true }),
  },
  {
    name: "session-ended notice",
    run: () =>
      show(shell(), "/", "#chat-list-sidebar-groups li", async () => {
        await act(async () => noteAuthFailure(401, "signed_out"));
        await waitFor(() => expect(document.getElementById("session-ended")).not.toBeNull());
      }),
  },
  {
    name: "access-ended notice",
    run: () => {
      noteAuthFailure(403, "account_disabled");
      return show(shell(), "/", "#access-ended");
    },
  },
  { name: "chats view", run: () => show(shell(<ChatsView page={1} />), "/chats", "#chats-view li") },
  { name: "reports view", run: () => show(shell(<ReportsView page={1} />), "/reports", `#reports-row-${reportId(3)}`) },
  {
    name: "report detail",
    run: () => show(shell(<ReportDetail reportId={reportId(1)} />), `/reports/${reportId(1)}`, "#report-detail-frame"),
  },
  { name: "search view", run: () => show(shell(<SearchView q="mcway" scope="all" page={1} />), "/search?q=mcway", "#search-results") },
  {
    name: "models panel",
    run: () => show(shell(), "/", "#chat-list-sidebar-groups li", openFromMenu("account-menu-models", "provider-openrouter-status")),
  },
  {
    name: "profile drawer",
    run: () => show(shell(), "/", "#chat-list-sidebar-groups li", openFromMenu("account-menu-profile", "profile-signout-all-row")),
  },
  {
    name: "onboarding step 1",
    run: () => {
      profileBody = emptyProfile();
      return show(shell(), "/", "#onboarding");
    },
  },
  {
    name: "report row",
    run: () =>
      show(
        <ul id="ids-report-rows">
          <ReportRow id={`reports-row-${reportId(1)}`} report={report(1)} />
        </ul>,
        "/reports",
        `#reports-row-${reportId(1)}-pdf`,
      ),
  },
  {
    name: "phone mobile drawer",
    run: async () => {
      mockViewport(390);
      return show(shell(), "/", "#mobile-tabs", async () => {
        fireEvent.click(screen.getByRole("button", { name: "Open chats" }));
        await screen.findByRole("dialog", { name: "Chats" });
      });
    },
  },
  {
    name: "phone account sheet",
    run: async () => {
      mockViewport(390);
      return show(shell(), "/", "#mobile-tabs", async () => {
        await click("mobile-tabs-you");
        await waitFor(() => expect(document.getElementById("account-sheet-profile")).not.toBeNull());
      });
    },
  },
];

describe("unique ids in rendered views", () => {
  it.each(views)("$name", async ({ run }) => {
    const container = await run();
    expect(container.querySelectorAll("*").length).toBeGreaterThan(3);
    expectUniqueIds(document.body);
  });

  it("widgets gallery", () => {
    const { container } = render(
      <div id="widget-gallery">
        {WIDGET_GALLERY.map(([name, widget]) => (
          <WidgetRenderer
            key={name}
            idPrefix={`gallery-${name}`}
            toolCallId={`tc-${name}`}
            args={{ widget }}
            locale="en-US"
            onPlanEdit={() => {}}
            onCartEdit={() => {}}
          />
        ))}
      </div>,
    );
    for (const [name] of WIDGET_GALLERY) expect(container.querySelector(`[id^='gallery-${name}']`), name).not.toBeNull();
    expectUniqueIds(container);
  });

  it("chat session with a streamed turn and sources", async () => {
    const sid = "ids-session";
    const { container } = render(
      withPlatform(
        <ChatSession
          id={sid}
          agentId="ids-agent"
          threadId={CHAT}
          locale="en-US"
          persona={{ ...DEFAULT_AGENT, name: "Sage" }}
          composerPlaceholder="Ask"
          composerLabel="Message"
          autoFocus={false}
          emptyHeading="h1"
          memory={null}
          onOpenProfile={() => {}}
          onRunningChange={() => {}}
          onClaimed={() => {}}
          onRunEnd={() => {}}
        />,
      ),
    );
    const input = document.getElementById(`${sid}-composer-input`) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Plan a Big Sur weekend." } });
    fireEvent.keyDown(input, { key: "Enter" });
    const agent = copilot.agents.get("ids-agent")!;
    await act(async () => {
      agent.emit("RUN_STARTED");
      agent.addMessage({ id: "u-1", role: "user", content: "Plan a Big Sur weekend." });
      agent.messages = [
        ...agent.messages,
        {
          id: "a-1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "s-1", function: { name: "web_search", arguments: '{"query":"big sur"}' } }],
        },
        { id: "t-1", role: "tool", toolCallId: "s-1", content: SEARCH_RESULT },
        { id: "a-2", role: "assistant", content: "Start at [McWay Falls](https://www.parks.ca.gov/mcway) for sunset." },
      ] as never;
      agent.emit("TEXT_MESSAGE_CONTENT");
    });
    expectUniqueIds(container);
    await act(async () => copilot.runs.at(-1)?.finish());
    await act(async () => agent.emit("RUN_FINISHED"));
    await waitFor(() => expect(container.querySelector(`[id$='-sources']`)).not.toBeNull());
    expectUniqueIds(container);
  });

  it("report panel", async () => {
    const hist = syncHistory();
    try {
      const { container } = renderShell(<ShellFrame>{null}</ShellFrame>);
      await act(async () => hist.visit(`/chats/${CHAT}`));
      const card = `chat-pane-${CHAT}-artifact-card-c-${reportId(1)}`;
      await waitFor(() => expect(document.getElementById(card)).not.toBeNull());
      await click(card);
      await waitFor(() => expect(document.getElementById(`chat-pane-${CHAT}-report-panel-frame`)).not.toBeNull());
      await settle();
      expectUniqueIds(container);
    } finally {
      hist.restore();
    }
  });
});
