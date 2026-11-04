import type { UsageView } from "@oab/shared/usage";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefusalNotice } from "@/components/usage/RefusalNotice";
import { UsageMeter } from "@/components/usage/UsageMeter";
import { expectUniqueIds } from "../../../../packages/ui/test/support/ids.ts";
import { installFakeTurnstile, stubSiteKey } from "./fakeTurnstile";

const P = "sidebar-usage-meter";
const S = "chat-pane-x-refusal";
const el = (id: string) => document.getElementById(id);

const view = (humanCheck: UsageView["humanCheck"]): UsageView => ({
  month: { used: 0, limit: 50, resetsAt: "2026-12-01T00:00:00.000Z" },
  hour: { used: 0, limit: 10, resetsAt: null },
  running: { mine: 0, limit: 1 },
  humanCheck,
});

let checked: boolean;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubSiteKey();
  checked = false;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/human-check")) {
      checked = true;
      return Response.json({ humanCheck: "done" });
    }
    return Response.json(view(checked ? "done" : "required"));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete window.turnstile;
});

describe("the human check from the usage meter (A28)", () => {
  it("opens the dialog from #P-check-open, and after the check the meter refetches and drops the line", async () => {
    const t = installFakeTurnstile();
    const { container } = render(<UsageMeter id={P} variant="sidebar" />);
    await waitFor(() => expect(el(`${P}-check-open`)).not.toBeNull());
    expect(el(`${P}-check-open`)).toHaveTextContent("Start the check");
    expectUniqueIds(container);
    fireEvent.click(el(`${P}-check-open`)!);
    expect(el("human-check-dialog")).not.toBeNull();
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    await act(async () => t.last().callback("tok"));
    await waitFor(() => expect(el("human-check-dialog")).toBeNull());
    await waitFor(() => expect(el(`${P}-count`)).not.toBeNull());
    expect(el(`${P}-check`)).toBeNull();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/usage", "/api/human-check", "/api/usage"]);
  });

  it("closes the dialog on Cancel without checking", async () => {
    installFakeTurnstile();
    render(<UsageMeter id={P} variant="sidebar" />);
    await waitFor(() => expect(el(`${P}-check-open`)).not.toBeNull());
    fireEvent.click(el(`${P}-check-open`)!);
    fireEvent.click(el("human-check-cancel")!);
    expect(el("human-check-dialog")).toBeNull();
    expect(el(`${P}-check`)).not.toBeNull();
  });
});

describe("the human check from the human_check_required notice (A28)", () => {
  const refusal = { code: "human_check_required", message: "Confirm you're human before your first message." } as const;

  it("opens the dialog from #S-refusal-check-open and re-sends once the check passes", async () => {
    const t = installFakeTurnstile();
    const onRetry = vi.fn();
    const { container } = render(<RefusalNotice id={S} refusal={refusal} onRetry={onRetry} onDismiss={vi.fn()} />);
    expect(el(`${S}-title`)).toHaveTextContent("One quick check");
    expect(el(`${S}-check-open`)).toHaveTextContent("Check and send");
    expect(el(`${S}-retry`)).toBeNull();
    expectUniqueIds(container);
    fireEvent.click(el(`${S}-check-open`)!);
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => t.last().callback("tok"));
    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce());
    expect(el("human-check-dialog")).toBeNull();
  });

  it("doesn't re-send when the check is cancelled or fails", async () => {
    const t = installFakeTurnstile();
    fetchMock.mockImplementationOnce(async () => Response.json({ error: "human_check_failed" }, { status: 403 }));
    const onRetry = vi.fn();
    render(<RefusalNotice id={S} refusal={refusal} onRetry={onRetry} onDismiss={vi.fn()} />);
    fireEvent.click(el(`${S}-check-open`)!);
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    await act(async () => t.last().callback("bad"));
    await waitFor(() => expect(el("human-check-error")).not.toBeNull());
    fireEvent.click(el("human-check-cancel")!);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("shows no check button for the other refusals", () => {
    render(
      <RefusalNotice id={S} refusal={{ code: "server_busy", message: "busy", retryAfter: 60 }} onRetry={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(el(`${S}-check-open`)).toBeNull();
  });
});
