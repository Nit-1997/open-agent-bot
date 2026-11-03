import { emptyProfile, type Profile } from "@oab/shared/profile";
import { resetAuthState } from "@oab/ui/lib/authState.ts";
import { chatIndex } from "@oab/ui/lib/chatIndex.ts";
import { resetProfileStore } from "@oab/ui/lib/profile.ts";
import { historyRouter } from "@oab/ui/platform";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalApp } from "../src/LocalApp.tsx";
import { expectUniqueIds } from "./support/ids.ts";
import { mockViewport } from "./support/media.ts";

vi.mock("@copilotkit/react-core/v2", async () => (await import("./support/copilot.tsx")).copilotMock());

const REPORT = "e2eReport001";
const ONBOARDED: Profile = { ...emptyProfile(), name: "Local Person", onboardedAt: "2026-11-03" };

const REPORT_SUMMARY = {
  id: REPORT,
  title: "Big Sur weekend",
  createdAt: "2026-11-02T10:00:00.000Z",
  chatId: null,
  chatTitle: null,
  pdfReady: false,
  sizeBytes: 2048,
};

let profile: Profile = ONBOARDED;

function respond(url: string): Response {
  const path = url.split("?")[0];
  if (path === "/api/profile") return Response.json({ profile });
  if (path === "/api/models")
    return Response.json({ default: "openrouter/a", models: [{ id: "openrouter/a", label: "A", provider: "OpenRouter" }] });
  if (path === "/api/chats") return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
  if (path === "/api/reports") return Response.json({ items: [REPORT_SUMMARY], total: 1, page: 1, pageSize: 12 });
  if (path === `/api/reports/${REPORT}`) return Response.json({ report: REPORT_SUMMARY });
  if (path === "/api/search")
    return Response.json({ items: [], total: 0, page: 1, pageSize: 10, query: "abc", scope: "all", counts: { chats: 0, reports: 0 } });
  if (path === "/api/onboarding/options") return Response.json({ rows: {} });
  return Response.json({ error: "not_found" }, { status: 404 });
}

async function renderAt(href: string, width = 1440) {
  mockViewport(width);
  window.history.replaceState(null, "", href);
  const utils = render(<LocalApp router={historyRouter()} />);
  await waitFor(() => expect(document.querySelector("#shell-main, #onboarding")).not.toBeNull());
  await act(async () => {});
  return utils;
}

const NO_CLOUD_CHROME = ["[id$='-signout']", "[id$='-signout-form']", "[id$='-admin']", "[id$='-usage']", "[id^='admin-']"];

function expectNoCloudChrome() {
  for (const selector of NO_CLOUD_CHROME) expect(document.querySelector(selector), selector).toBeNull();
}

beforeEach(() => {
  profile = ONBOARDED;
  resetProfileStore();
  resetAuthState();
  chatIndex.reset();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => respond(url)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("LocalApp routes", { timeout: 20000 }, () => {
  it("/ renders the shell with the rail and no sign-out, admin or usage", async () => {
    const { container } = await renderAt("/");
    expect(document.getElementById("rail")).not.toBeNull();
    expect(document.getElementById("shell-not-found")).toBeNull();
    await act(async () => {
      fireEvent.click(document.getElementById("account-menu-button")!);
    });
    expect(document.getElementById("account-menu-profile")).not.toBeNull();
    expect(document.getElementById("account-menu-email")).toBeNull();
    expectNoCloudChrome();
    expectUniqueIds(container);
  });

  it("/chats renders the chats view", async () => {
    const { container } = await renderAt("/chats");
    await waitFor(() => expect(document.getElementById("chats-view-empty")).not.toBeNull());
    expectNoCloudChrome();
    expectUniqueIds(container);
  });

  it("/reports/<id> renders the report page", async () => {
    const { container } = await renderAt(`/reports/${REPORT}`);
    await waitFor(() => expect(document.getElementById("report-detail-back")).not.toBeNull());
    expect(document.getElementById("shell-not-found")).toBeNull();
    expectUniqueIds(container);
  });

  it("/search?q=abc renders the search view with the query", async () => {
    const { container } = await renderAt("/search?q=abc");
    await waitFor(() => expect(document.getElementById("search-empty")).not.toBeNull());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/search?q=abc&"))).toBe(true);
    expectUniqueIds(container);
  });

  it.each(["/admin", "/nope", "/reports/not-a-report-id", "/chats/x/y"])("%s renders the not-found view inside the shell", async (href) => {
    const { container } = await renderAt(href);
    expect(document.getElementById("shell-not-found-title")).toHaveTextContent("This page doesn't exist.");
    expect(document.getElementById("rail")).not.toBeNull();
    expectNoCloudChrome();
    expectUniqueIds(container);
  });

  it("follows history: Back to chat leaves the not-found view", async () => {
    await renderAt("/nope");
    await act(async () => {
      fireEvent.click(document.getElementById("shell-not-found-home")!);
    });
    expect(window.location.pathname).toBe("/");
    expect(document.getElementById("shell-not-found")).toBeNull();
    expect(document.getElementById("rail")).not.toBeNull();
  });

  it("shows onboarding before the shell when the profile is new", async () => {
    profile = { ...emptyProfile() };
    const { container } = await renderAt("/");
    expect(document.getElementById("onboarding")).not.toBeNull();
    expect(document.getElementById("rail")).toBeNull();
    expectUniqueIds(container);
  });

  it("renders the phone layout with no sign-out or usage in the account sheet", async () => {
    const { container } = await renderAt("/", 390);
    await act(async () => {
      fireEvent.click(document.getElementById("mobile-tabs-you")!);
    });
    await waitFor(() => expect(document.getElementById("account-sheet-profile")).not.toBeNull());
    expect(document.getElementById("account-sheet-email")).toBeNull();
    expectNoCloudChrome();
    expectUniqueIds(container);
  });
});
