import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HumanCheckDialog } from "@/components/auth/HumanCheckDialog";
import { loadTurnstile } from "@/components/auth/Turnstile";
import { TURNSTILE_SCRIPT } from "@/lib/turnstile";
import { expectUniqueIds } from "../../../../packages/ui/test/support/ids.ts";
import { installFakeTurnstile, PASS_SITE_KEY, stubSiteKey } from "./fakeTurnstile";

const el = (id: string) => document.getElementById(id);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubSiteKey();
  fetchMock = vi.fn(async () => Response.json({ humanCheck: "done" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete window.turnstile;
});

function mount() {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<HumanCheckDialog onDone={onDone} onCancel={onCancel} />);
  return { ...utils, onDone, onCancel };
}

describe("HumanCheckDialog", () => {
  it("is a modal dialog with the title, the widget (action human_check, the site key) and Cancel focused", async () => {
    const t = installFakeTurnstile();
    mount();
    const dialog = el("human-check-dialog")!;
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "human-check-title");
    expect(el("human-check-title")).toHaveTextContent("One quick check");
    expect(el("human-check-body")).toHaveTextContent("Confirm you're human before your first message.");
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    expect([t.last().action, t.last().sitekey]).toEqual(["human_check", PASS_SITE_KEY]);
    expect(t.last().el).toBe(el("human-check-widget"));
    expect(document.activeElement).toBe(el("human-check-cancel"));
    expect(el("human-check-error")).toBeNull();
    expectUniqueIds(el("human-check-overlay")!);
  });

  it("posts the token to /api/human-check and calls onDone on success", async () => {
    const t = installFakeTurnstile();
    const { onDone } = mount();
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    await act(async () => t.last().callback("tok-1"));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/human-check");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok-1" });
  });

  it("shows the error on a failed check, keeps the dialog open and renders a fresh widget", async () => {
    const t = installFakeTurnstile();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "human_check_failed", message: "x" }, { status: 403 }));
    const { onDone } = mount();
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    await act(async () => t.last().callback("tok-bad"));
    await waitFor(() => expect(el("human-check-error")).toHaveTextContent("We couldn't verify that. Try again."));
    expect(el("human-check-error")).toHaveAttribute("role", "alert");
    await waitFor(() => expect(t.rendered).toHaveLength(2));
    expect(t.removed).toEqual(["w1"]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows the server message when checks are unavailable, and the fallback on a network error", async () => {
    const t = installFakeTurnstile();
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { error: "human_check_unavailable", message: "Sign-up checks are unavailable right now. Try again in a minute." },
          { status: 503 },
        ),
      )
      .mockRejectedValueOnce(new TypeError("offline"));
    mount();
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    await act(async () => t.last().callback("tok-1"));
    await waitFor(() => expect(el("human-check-error")).toHaveTextContent("Sign-up checks are unavailable right now."));
    await waitFor(() => expect(t.rendered).toHaveLength(2));
    await act(async () => t.last().callback("tok-2"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(el("human-check-error")).toHaveTextContent("Sign-up checks are unavailable right now. Try again in a minute.");
  });

  it("shows the error when the widget itself fails", async () => {
    const t = installFakeTurnstile();
    mount();
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    act(() => t.last().error());
    expect(el("human-check-error")).toHaveTextContent("We couldn't verify that. Try again.");
  });

  it("shows unavailable and no widget without a site key, or with a test key outside a local stack", () => {
    for (const [key, url] of [
      ["", "http://127.0.0.1:18741"],
      [PASS_SITE_KEY, "https://abcdefghijklmnopqrst.supabase.co"],
    ]) {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", key);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      const t = installFakeTurnstile();
      const { unmount } = mount();
      expect(el("human-check-widget")).toBeNull();
      expect(el("human-check-error")).toHaveTextContent("Sign-up checks are unavailable right now. Try again in a minute.");
      expect(t.rendered).toHaveLength(0);
      unmount();
    }
  });

  it("closes on Cancel and on Escape, and keeps Tab inside the dialog", async () => {
    installFakeTurnstile();
    const { onCancel } = mount();
    fireEvent.click(el("human-check-cancel")!);
    fireEvent.keyDown(el("human-check-dialog")!, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    el("human-check-cancel")!.focus();
    fireEvent.keyDown(el("human-check-dialog")!, { key: "Tab" });
    expect(document.activeElement).toBe(el("human-check-cancel"));
    fireEvent.keyDown(el("human-check-dialog")!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(el("human-check-cancel"));
  });

  it("renders into document.body, outside the caller", () => {
    installFakeTurnstile();
    const { container } = mount();
    expect(container.querySelector("#human-check-dialog")).toBeNull();
    expect(document.body.querySelector("#human-check-overlay > #human-check-dialog")).not.toBeNull();
  });
});

describe("loadTurnstile", () => {
  it("injects Cloudflare's explicit-render script once, drops it when it fails and loads it again on the next try", async () => {
    delete window.turnstile;
    const p = loadTurnstile();
    document.querySelector("script#turnstile-api-script")!.dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow("turnstile failed to load");
    expect(document.querySelector("script#turnstile-api-script")).toBeNull();
    const retry = loadTurnstile();
    const again = loadTurnstile();
    const scripts = document.querySelectorAll("script#turnstile-api-script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toHaveAttribute("src", TURNSTILE_SCRIPT);
    const t = installFakeTurnstile();
    document.querySelector("script#turnstile-api-script")!.dispatchEvent(new Event("load"));
    expect(await retry).toBe(t.api);
    expect(await again).toBe(t.api);
    document.querySelector("script#turnstile-api-script")!.remove();
    delete window.turnstile;
  });
  it("resolves at once when the API is already on the page", async () => {
    const t = installFakeTurnstile();
    expect(await loadTurnstile()).toBe(t.api);
    expect(document.querySelectorAll("script#turnstile-api-script")).toHaveLength(0);
  });
});
