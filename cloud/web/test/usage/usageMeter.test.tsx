import type { UsageView } from "@oab/shared/usage";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageMeter } from "@/components/usage/UsageMeter";
import { noteRunSettled } from "../../../../packages/ui/src/platform/runSettled.ts";
import { expectUniqueIds } from "../../../../packages/ui/test/support/ids.ts";

const P = "sidebar-usage-meter";
const el = (id: string) => document.getElementById(id);

const view = (used: number, limit = 50, humanCheck: UsageView["humanCheck"] = "off"): UsageView => ({
  month: { used, limit, resetsAt: "2026-12-01T00:00:00.000Z" },
  hour: { used: 1, limit: 10, resetsAt: null },
  running: { mine: 0, limit: 1 },
  humanCheck,
});

let answers: Array<() => Response | Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  answers = [];
  fetchMock = vi.fn(async () => (answers.shift() ?? (() => Response.json(view(0))))());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown, status = 200) => answers.push(() => Response.json(body, { status }));

async function mount(id = P, variant: "sidebar" | "sheet" = "sidebar") {
  const utils = render(<UsageMeter id={id} variant={variant} />);
  await waitFor(() => expect(el(id)?.getAttribute("aria-busy")).not.toBe("true"));
  return utils;
}

describe("UsageMeter (D13)", () => {
  it("shows a two-bar skeleton while the first fetch is open, then calls GET /api/usage", async () => {
    let release: (r: Response) => void = () => {};
    answers.push(() => new Promise<Response>((r) => (release = r)));
    const { container } = render(<UsageMeter id={P} variant="sidebar" />);
    expect(el(P)).toHaveAttribute("aria-busy", "true");
    expect(el(`${P}-skeleton`)?.children).toHaveLength(2);
    expect(el(`${P}-count`)).toBeNull();
    expectUniqueIds(container);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/usage");
    expect((fetchMock.mock.calls[0][1] as RequestInit).cache).toBe("no-store");
    await act(async () => release(Response.json(view(3))));
    await waitFor(() => expect(el(`${P}-count`)).toHaveTextContent("3 of 50 requests used"));
    expect(el(`${P}-skeleton`)).toBeNull();
  });

  it("normal: label, reset day with the UTC hint, count and a progress bar, with no warning", async () => {
    answer(view(12));
    const { container } = await mount();
    expect(el(P)).toHaveAttribute("data-level", "normal");
    expect(el(`${P}-label`)).toHaveTextContent("This month");
    expect(el(`${P}-reset`)).toHaveTextContent("resets 1 Dec");
    expect(el(`${P}-reset`)).toHaveAttribute("title", "00:00 UTC");
    expect(el(`${P}-count`)).toHaveTextContent("12 of 50 requests used");
    const bar = el(`${P}-bar`)!;
    expect(bar).toHaveAttribute("role", "progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "50");
    expect(bar).toHaveAccessibleName("Requests used this month");
    expect(el(`${P}-bar-fill`)?.style.width).toBe("24%");
    expect(el(`${P}-bar-fill`)?.className).not.toContain("bg-warn-fg");
    for (const part of ["low", "mac", "mac-link", "exhausted", "check", "unavailable"]) expect(el(`${P}-${part}`), part).toBeNull();
    expectUniqueIds(container);
  });

  it("low: the warn bar, the requests left and the Mac link", async () => {
    answer(view(42));
    const { container } = await mount();
    expect(el(P)).toHaveAttribute("data-level", "low");
    expect(el(`${P}-count`)).toHaveTextContent("42 of 50 requests used");
    expect(el(`${P}-bar-fill`)?.className).toContain("bg-warn-fg");
    expect(el(`${P}-bar-fill`)?.style.width).toBe("84%");
    expect(el(`${P}-low`)).toHaveTextContent("8 requests left this month.");
    expect(el(`${P}-mac`)).toHaveTextContent("Want no limits? Run Open Agent on your own Mac. It's free and open source.");
    const link = el(`${P}-mac-link`)!;
    expect(link).toHaveAttribute("href", "https://github.com/Nit-1997/open-agent-bot/releases/latest");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Run Open Agent on your own Mac");
    expect(el(`${P}-exhausted`)).toBeNull();
    expectUniqueIds(container);
  });

  it("exhausted: the full count, when requests open again, and the Mac link", async () => {
    answer(view(50));
    const { container } = await mount();
    expect(el(P)).toHaveAttribute("data-level", "exhausted");
    expect(el(`${P}-count`)).toHaveTextContent("50 of 50 requests used");
    expect(el(`${P}-bar-fill`)?.style.width).toBe("100%");
    expect(el(`${P}-exhausted`)).toHaveTextContent("Requests open again on 1 December.");
    expect(el(`${P}-mac-link`)).toHaveAttribute("href", "https://github.com/Nit-1997/open-agent-bot/releases/latest");
    expect(el(`${P}-low`)).toBeNull();
    expectUniqueIds(container);
  });

  it("caps the bar at 100% when more than the cap was used", async () => {
    answer(view(60));
    await mount();
    expect(el(`${P}-bar-fill`)?.style.width).toBe("100%");
    expect(el(`${P}-bar`)).toHaveAttribute("aria-valuenow", "50");
    expect(el(`${P}-count`)).toHaveTextContent("60 of 50 requests used");
  });

  it("human check: says one quick check is needed before the first message", async () => {
    answer(view(0, 50, "required"));
    const { container } = await mount();
    expect(el(`${P}-check`)).toHaveTextContent("One quick check before your first message");
    expect(el(`${P}-count`)).toHaveTextContent("0 of 50 requests used");
    expectUniqueIds(container);
  });

  it.each([
    ["a 503", () => answer({ error: "usage_unavailable", message: "Can't check your usage right now." }, 503)],
    ["a 401", () => answer({ error: "signed_out" }, 401)],
    ["an unreadable body", () => answers.push(() => new Response("<html>", { status: 200 }))],
    ["a malformed view", () => answer({ month: { used: "3", limit: 50, resetsAt: "x" } })],
    ["a network error", () => answers.push(() => Promise.reject(new TypeError("fetch failed")))],
    ["an unavailable human check", () => answer(view(4, 50, "unavailable"))],
  ])("unavailable on %s, with no numbers and a retry button", async (_name, arrange) => {
    arrange();
    const { container } = await mount();
    expect(el(`${P}-unavailable`)).toHaveTextContent("Usage unavailable");
    expect(el(`${P}-count`)).toBeNull();
    expect(el(`${P}-bar`)).toBeNull();
    expect(el(P)?.textContent).not.toMatch(/\d/);
    expectUniqueIds(container);
    answer(view(5));
    await act(async () => fireEvent.click(el(`${P}-retry`)!));
    await waitFor(() => expect(el(`${P}-count`)).toHaveTextContent("5 of 50 requests used"));
    expect(el(`${P}-unavailable`)).toBeNull();
  });

  it("refetches after each settled run without a reload, keeping the numbers on screen meanwhile", async () => {
    answer(view(1));
    await mount();
    expect(el(`${P}-count`)).toHaveTextContent("1 of 50 requests used");
    let release: (r: Response) => void = () => {};
    answers.push(() => new Promise<Response>((r) => (release = r)));
    act(() => noteRunSettled());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(el(`${P}-count`)).toHaveTextContent("1 of 50 requests used");
    expect(el(`${P}-skeleton`)).toBeNull();
    await act(async () => release(Response.json(view(2))));
    await waitFor(() => expect(el(`${P}-count`)).toHaveTextContent("2 of 50 requests used"));
    answer(view(3));
    act(() => noteRunSettled());
    await waitFor(() => expect(el(`${P}-count`)).toHaveTextContent("3 of 50 requests used"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows unavailable, never the old numbers, when a refetch fails", async () => {
    answer(view(9));
    await mount();
    answer({ error: "usage_unavailable" }, 503);
    act(() => noteRunSettled());
    await waitFor(() => expect(el(`${P}-unavailable`)).not.toBeNull());
    expect(el(`${P}-count`)).toBeNull();
  });

  it("uses the slot id as the prefix for the sheet variant too", async () => {
    answer(view(42));
    const { container } = await mount("account-sheet-usage-meter", "sheet");
    expect(el("account-sheet-usage-meter-count")).toHaveTextContent("42 of 50 requests used");
    expect(el("account-sheet-usage-meter-mac-link")).not.toBeNull();
    expect(el(P)).toBeNull();
    expectUniqueIds(container);
  });
});
