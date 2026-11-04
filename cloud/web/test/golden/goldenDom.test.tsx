import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyProfile, type Profile } from "@oab/shared/profile";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShellNotFound from "@/app/(app)/not-found";
import { ChatsView } from "@oab/ui/components/chat/ChatsView.tsx";
import { ReportDetail } from "@oab/ui/components/reports/ReportDetail.tsx";
import { ReportRow } from "@oab/ui/components/reports/ReportRow.tsx";
import { ReportsView } from "@oab/ui/components/reports/ReportsView.tsx";
import { SearchView } from "@oab/ui/components/search/SearchView.tsx";
import { AppShell } from "@oab/ui/components/shell/AppShell.tsx";
import { noteAuthFailure, resetAuthState } from "@oab/ui/lib/authState.ts";
import { chatIndex } from "@oab/ui/lib/chatIndex.ts";
import { resetProfileStore } from "@oab/ui/lib/profile.ts";
import { copilot } from "../../../packages/ui/test/support/copilot.ts";
import { mockViewport } from "../../../packages/ui/test/support/media.ts";
import { nav } from "../support/navigation";
import { pinEnvironment } from "./determinism";
import { goldenHtml } from "./serialize";
import { wrapGolden } from "./wrap";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());
vi.mock("@copilotkit/react-core/v2", async () => (await import("../../../packages/ui/test/support/copilot.ts")).copilotMock());

const FIXTURES = join(import.meta.dirname, "../fixtures/golden-dom");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const chatId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const reportId = (n: number) => `report${String(n).padStart(6, "0")}`;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-02T12:00:00Z");

const onboarded = (): Profile => ({ ...emptyProfile(), name: "Nitin Bhat", onboardedAt: "2026-10-30" });

const chats = Array.from({ length: 7 }, (_, i) => ({
  id: chatId(i + 1),
  title: i === 2 ? "" : `Chat ${i + 1}`,
  lastMessageAt: new Date(NOW - (i * 19 + 2) * HOUR).toISOString(),
}));

const report = (n: number, over: Record<string, unknown> = {}) => ({
  id: reportId(n),
  title: `Report ${n}`,
  createdAt: new Date(NOW - n * 30 * HOUR).toISOString(),
  chatId: n === 2 ? null : CHAT,
  chatTitle: n === 2 ? null : "Big Sur",
  pdfReady: n === 1,
  sizeBytes: 1024 * n,
  ...over,
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

let profileBody: Profile;

function respond(url: string): Response {
  const path = url.split("?")[0];
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
  if (path === "/api/reports") return Response.json({ items: [1, 2, 3].map((n) => report(n)), total: 3, page: 1, pageSize: 12 });
  if (path === `/api/reports/${reportId(1)}`) return Response.json({ report: report(1) });
  if (path === "/api/search") return Response.json(searchBody);
  if (path === "/api/providers") return Response.json({ providers });
  if (path === "/api/settings") return Response.json({ braveSearch: false });
  if (path === "/api/onboarding/options") return Response.json(options);
  return Response.json({ error: "not_found" }, { status: 404 });
}

let restore: () => void;

beforeEach(() => {
  restore = pinEnvironment();
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
  resetAuthState();
  restore();
});

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => {});
}

async function capture(ui: ReactNode, path: string, ready: string, after?: () => Promise<void>, opts: { isAdmin?: boolean } = {}) {
  nav.reset(path);
  const { container } = render(wrapGolden(ui, opts));
  await waitFor(() => expect(document.querySelector(ready)).not.toBeNull());
  await settle();
  if (after) {
    await after();
    await settle();
  }
  return goldenHtml(container);
}

const shell = (children: ReactNode = null) => <AppShell>{children}</AppShell>;

async function openAccountMenu() {
  await act(async () => {
    fireEvent.click(document.getElementById("account-menu-button")!);
  });
}

async function openFromMenu(item: string, ready: string) {
  await openAccountMenu();
  await act(async () => {
    fireEvent.click(document.getElementById(item)!);
  });
  await waitFor(() => expect(document.getElementById(ready)).not.toBeNull());
}

type View = Readonly<{ name: string; run: () => Promise<string> }>;

const views: View[] = [
  {
    name: "app-shell-menu",
    run: () => capture(shell(), "/", "#chat-list-sidebar-groups li", openAccountMenu),
  },
  {
    name: "app-shell-menu-admin",
    run: () => capture(shell(), "/", "#chat-list-sidebar-groups li", openAccountMenu, { isAdmin: true }),
  },
  {
    name: "signed-out-banner",
    run: () =>
      capture(shell(), "/", "#chat-list-sidebar-groups li", async () => {
        await act(async () => noteAuthFailure(401, "signed_out"));
      }),
  },
  {
    name: "access-disabled",
    run: () => {
      noteAuthFailure(403, "account_disabled");
      return capture(shell(), "/", "#session-disabled");
    },
  },
  { name: "chats-view", run: () => capture(shell(<ChatsView page={1} />), "/chats", "#chats-view li") },
  { name: "reports-view", run: () => capture(shell(<ReportsView page={1} />), "/reports", `#reports-row-${reportId(3)}`) },
  {
    name: "report-detail",
    run: () => capture(shell(<ReportDetail reportId={reportId(1)} />), `/reports/${reportId(1)}`, "#report-detail-frame"),
  },
  {
    name: "search-view",
    run: () => capture(shell(<SearchView q="mcway" scope="all" page={1} />), "/search?q=mcway", "#search-results"),
  },
  {
    name: "models-panel",
    run: () =>
      capture(shell(), "/", "#chat-list-sidebar-groups li", () => openFromMenu("account-menu-models", "provider-openrouter-status")),
  },
  {
    name: "profile-drawer",
    run: () => capture(shell(), "/", "#chat-list-sidebar-groups li", () => openFromMenu("account-menu-profile", "profile-signout-all-row")),
  },
  {
    name: "onboarding-step-1",
    run: () => {
      profileBody = emptyProfile();
      return capture(shell(), "/", "#onboarding");
    },
  },
  { name: "not-found", run: () => capture(shell(<ShellNotFound />), "/nope", "#shell-not-found-title") },
  {
    name: "report-row",
    run: () =>
      capture(
        <ul id="golden-report-rows">
          <ReportRow id={`reports-row-${reportId(1)}`} report={report(1)} />
        </ul>,
        "/reports",
        `#reports-row-${reportId(1)}-pdf`,
      ),
  },
];

describe("golden DOM", () => {
  it.each(views)("$name renders the recorded DOM", async ({ name, run }) => {
    const html = await run();
    const file = join(FIXTURES, `${name}.html`);
    if (UPDATE) {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(file, html);
    }
    expect(existsSync(file), `missing fixture ${name}.html; run with UPDATE_GOLDEN=1`).toBe(true);
    expect(html).toBe(readFileSync(file, "utf8"));
  });
});
