import type { RunRefusal } from "@oab/shared/runRefusals";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefusalNotice } from "@/components/usage/RefusalNotice";
import { DESKTOP_URL } from "@/lib/usageCopy";
import { expectUniqueIds } from "../../../../packages/ui/test/support/ids.ts";

const S = "chat-pane-x-refusal";
const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const el = (id: string) => document.getElementById(id);

const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

function mount(refusal: RunRefusal) {
  const onRetry = vi.fn();
  const onDismiss = vi.fn();
  const utils = render(<RefusalNotice id={S} refusal={refusal} onRetry={onRetry} onDismiss={onDismiss} />);
  return { ...utils, onRetry, onDismiss };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("RefusalNotice (D13)", () => {
  it("limit_monthly: a status card with the cap, the reset day, the Mac link and no Send again", () => {
    const { container, onDismiss } = mount({
      code: "limit_monthly",
      message: "You've used this month's 50 requests.",
      retryAfter: 2_376_000,
      retryAt: "2026-12-01T00:00:00.000Z",
      limit: 50,
      used: 50,
      window: "month",
    });
    expect(el(S)).toHaveAttribute("role", "status");
    expect(el(`${S}-title`)).toHaveTextContent("You've used this month's 50 requests");
    expect(el(`${S}-body`)).toHaveTextContent("Your chats and reports are still here. Requests open again on 1 December.");
    expect(el(`${S}-countdown`)).toBeNull();
    expect(el(`${S}-retry`)).toBeNull();
    const link = el(`${S}-mac-link`)!;
    expect(link).toHaveTextContent("Run it on your Mac");
    expect(link).toHaveAttribute("href", DESKTOP_URL);
    expect(link).toHaveAttribute("href", "https://github.com/Nit-1997/open-agent-bot/releases/latest");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.querySelector("[role=alert]")).toBeNull();
    fireEvent.click(el(`${S}-dismiss`)!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expectUniqueIds(container);
  });

  it.each(["limit_hourly", "limit_attempts"] as const)("%s: slow down, counting down to retryAt, Send again disabled until 0", (code) => {
    const { container, onRetry } = mount({
      code,
      message: "You're sending messages quickly. Try again in 40 seconds.",
      retryAfter: 40,
      retryAt: at(40),
      window: code === "limit_hourly" ? "hour" : "attempts",
    });
    expect(el(`${S}-title`)).toHaveTextContent("Slow down");
    expect(el(`${S}-body`)).toHaveTextContent("You're sending messages quickly. Try again in 40 seconds.");
    const countdown = el(`${S}-countdown`)!;
    expect(countdown).toHaveAttribute("aria-live", "polite");
    expect(countdown).toHaveTextContent("You can send again in 40 seconds.");
    const retry = el(`${S}-retry`) as HTMLButtonElement;
    expect(retry).toHaveTextContent("Send again");
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    tick(1000);
    expect(countdown).toHaveTextContent("You can send again in 39 seconds.");
    expect(el(`${S}-body`)).toHaveTextContent("Try again in 40 seconds.");
    tick(38_000);
    expect(countdown).toHaveTextContent("You can send again in 1 second.");
    expect(retry).toBeDisabled();
    tick(1000);
    expect(countdown).toHaveTextContent("You can send again now.");
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(el(`${S}-mac-link`)).toBeNull();
    expectUniqueIds(container);
  });

  it("server_busy: busy with a 60-second countdown", () => {
    mount({
      code: "server_busy",
      message: "The demo server is at capacity right now. Try again in a minute.",
      retryAfter: 60,
      retryAt: at(60),
      limit: 8,
      used: 8,
      window: "server",
    });
    expect(el(`${S}-title`)).toHaveTextContent("Busy");
    expect(el(`${S}-body`)).toHaveTextContent("The demo server is at capacity right now. Try again in a minute.");
    expect(el(`${S}-countdown`)).toHaveTextContent("You can send again in 60 seconds.");
    expect(el(`${S}-retry`)).toBeDisabled();
    tick(60_000);
    expect(el(`${S}-countdown`)).toHaveTextContent("You can send again now.");
    expect(el(`${S}-retry`)).toBeEnabled();
    expect(el(`${S}-mac-link`)).toBeNull();
  });

  it("counts down from retryAfter when retryAt is missing", () => {
    mount({ code: "server_busy", message: "busy", retryAfter: 3 });
    expect(el(`${S}-countdown`)).toHaveTextContent("You can send again in 3 seconds.");
    tick(3000);
    expect(el(`${S}-retry`)).toBeEnabled();
  });

  it("limit_running: still working, Send again enabled right away, no countdown", () => {
    const { onRetry } = mount({
      code: "limit_running",
      message: "You can run one chat at a time. Wait for the other one to finish or stop it.",
      retryAfter: 5,
      retryAt: at(5),
      limit: 1,
      used: 1,
      window: "running",
    });
    expect(el(`${S}-title`)).toHaveTextContent("Still working");
    expect(el(`${S}-body`)).toHaveTextContent("You can run one chat at a time. Wait for the other one to finish or stop it.");
    expect(el(`${S}-countdown`)).toBeNull();
    expect(el(`${S}-retry`)).toBeEnabled();
    fireEvent.click(el(`${S}-retry`)!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(el(`${S}-mac-link`)).toBeNull();
  });

  it.each([
    ["usage_unavailable", "Can't check your usage right now. Try again in a minute."],
    ["human_check_unavailable", "Sign-up checks are unavailable right now. Try again in a minute."],
  ] as const)("%s: can't send right now with the server message and a countdown", (code, message) => {
    mount({ code, message, retryAfter: 60, retryAt: at(60) });
    expect(el(`${S}-title`)).toHaveTextContent("Can't send right now");
    expect(el(`${S}-body`)).toHaveTextContent(message);
    expect(el(`${S}-countdown`)).toHaveTextContent("You can send again in 60 seconds.");
    expect(el(`${S}-retry`)).toBeDisabled();
    tick(60_000);
    expect(el(`${S}-retry`)).toBeEnabled();
  });

  it("human_check_required: one quick check, without Send again until the check dialog exists", () => {
    const { container } = mount({ code: "human_check_required", message: "Confirm you're human before your first message." });
    expect(el(`${S}-title`)).toHaveTextContent("One quick check");
    expect(el(`${S}-body`)).toHaveTextContent("Confirm you're human before your first message.");
    expect(el(`${S}-countdown`)).toBeNull();
    expect(el(`${S}-retry`)).toBeNull();
    expect(el(`${S}-mac-link`)).toBeNull();
    expect(el(`${S}-dismiss`)).toHaveTextContent("Dismiss");
    expectUniqueIds(container);
  });

  it("stops ticking once the countdown reaches zero", () => {
    mount({ code: "limit_hourly", message: "slow", retryAt: at(2) });
    tick(2000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
