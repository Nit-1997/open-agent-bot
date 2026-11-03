import { emptyProfile } from "@oab/shared/profile";
import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeUrls } from "./support/copilot.tsx";
import { mockViewport } from "./support/media.ts";

vi.mock("@copilotkit/react-core/v2", async () => (await import("./support/copilot.tsx")).copilotMock());

function respond(url: string): Response {
  const path = url.split("?")[0];
  if (path === "/api/profile") return Response.json({ profile: { ...emptyProfile(), name: "Local Person", onboardedAt: "2026-11-03" } });
  if (path === "/api/models") return Response.json({ default: null, models: [] });
  if (path === "/api/chats") return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
  return Response.json({ error: "not_found" }, { status: 404 });
}

beforeEach(() => {
  vi.resetModules();
  runtimeUrls.length = 0;
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
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("main bootstrap", { timeout: 20000 }, () => {
  it("configures the API at /api, applies the stored theme and renders the route from the address bar", async () => {
    localStorage.setItem("theme", "dark");
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(null, "", "/chats");
    await act(async () => {
      await import("../src/main.tsx");
    });
    await waitFor(() => expect(document.getElementById("chats-view-empty")).not.toBeNull());
    expect(document.documentElement).toHaveClass("dark");
    const { api } = await import("@oab/ui/platform/api");
    expect(api().url("/chats")).toBe("/api/chats");
    expect(runtimeUrls.at(-1)).toBe("/api/copilotkit");
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !url.startsWith("/api/"))).toEqual([]);
  });

  it("refuses to start without a #root element", async () => {
    await expect(import("../src/main.tsx")).rejects.toThrow("#root");
  });
});
