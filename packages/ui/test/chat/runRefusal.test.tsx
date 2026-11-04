import { AbstractAgent, type BaseEvent, EventType } from "@ag-ui/client";
import { DEFAULT_AGENT } from "@oab/shared/profile";
import type { RunRefusal } from "@oab/shared/runRefusals";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { EMPTY, type Observable } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSession } from "../../src/components/chat/ChatSession.tsx";
import { type Platform, PlatformProvider, type PlatformSlots, type RunRefusalNoticeProps } from "../../src/platform/index.ts";
import { navRouter } from "../support/navigation.tsx";
import { expectUniqueIds } from "../support/ids.ts";

class FakeAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}

const mounted: { agent?: FakeAgent } = {};
const runs: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
const runAgent = vi.fn(() => new Promise<void>((resolve, reject) => runs.push({ resolve, reject })));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => {
    const [agent] = useState(() => new FakeAgent());
    mounted.agent = agent;
    return { agent };
  },
  useCopilotKit: () => ({ copilotkit: { addContext: () => "ctx", removeContext: () => {}, runAgent, stopAgent: vi.fn() } }),
}));

const SID = "refused";
const el = (id: string) => document.getElementById(id);
const notice = () => el(`${SID}-refusal`);
const banner = () => el(`${SID}-error`);

const seen: RunRefusalNoticeProps[] = [];

function TestNotice(props: RunRefusalNoticeProps) {
  seen.push(props);
  return (
    <div id={props.id} role="status">
      <span id={`${props.id}-code`}>{props.refusal.code}</span>
      <button id={`${props.id}-again`} type="button" onClick={props.onRetry}>
        Send again
      </button>
      <button id={`${props.id}-close`} type="button" onClick={props.onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

const SLOT: PlatformSlots = Object.freeze({ runRefusal: { codes: ["limit_monthly", "limit_hourly"] as const, Notice: TestNotice } });

const MONTHLY = {
  error: "limit_monthly",
  message: "You've used this month's 3 requests.",
  retryAfter: 2330000,
  retryAt: "2026-12-01T00:00:00.000Z",
  limit: 3,
  used: 3,
  window: "month",
};

const httpRefusal = (body: object, status = 429) => `HTTP ${status}: ${JSON.stringify(body)}`;

function session() {
  return (
    <ChatSession
      id={SID}
      agentId="openagent"
      threadId="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
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
    />
  );
}

function mount(slots?: PlatformSlots) {
  if (!slots) return render(session());
  const platform: Platform = { router: navRouter, user: { email: "ntn@example.test", name: "Nitin" }, slots };
  return render(<PlatformProvider platform={platform}>{session()}</PlatformProvider>);
}

async function send(text = "Plan a weekend in Lisbon.") {
  const input = el(`${SID}-composer-input`) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(runs.length).toBeGreaterThan(0));
}

async function runErrorEvent(message: string, code?: string) {
  await act(async () => {
    for (const s of mounted.agent!.subscribers) await s.onRunErrorEvent?.({ event: { type: EventType.RUN_ERROR, code, message } } as never);
  });
}

async function endRun(outcome: "resolve" | Error) {
  await act(async () => {
    const run = runs.at(-1)!;
    if (outcome === "resolve") run.resolve();
    else run.reject(outcome);
  });
}

beforeEach(() => {
  runs.length = 0;
  seen.length = 0;
  runAgent.mockClear();
});

describe("run refusals through the runRefusal slot", () => {
  it("renders the slot's notice instead of the banner for a listed code from a RUN_ERROR event", async () => {
    const { container } = mount(SLOT);
    await send();
    await runErrorEvent(httpRefusal(MONTHLY));
    await endRun("resolve");
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(banner()).toBeNull();
    expect(el(`${SID}-refusal-code`)).toHaveTextContent("limit_monthly");
    const refusal: RunRefusal = seen.at(-1)!.refusal;
    expect(refusal).toEqual({
      code: "limit_monthly",
      message: "You've used this month's 3 requests.",
      retryAfter: 2330000,
      retryAt: "2026-12-01T00:00:00.000Z",
      limit: 3,
      used: 3,
      window: "month",
    });
    expectUniqueIds(container);
  });

  it("renders the notice for a listed code that arrives through the run() rejection", async () => {
    mount(SLOT);
    await send();
    await endRun(new Error(httpRefusal({ error: "limit_hourly", message: "You're sending messages quickly. Try again in 40 seconds." })));
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(el(`${SID}-refusal-code`)).toHaveTextContent("limit_hourly");
    expect(banner()).toBeNull();
  });

  it("shows one notice and no banner when both error paths report the refusal", async () => {
    mount(SLOT);
    await send();
    await runErrorEvent(httpRefusal(MONTHLY));
    await endRun(new Error(httpRefusal(MONTHLY)));
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(document.querySelectorAll(`[id='${SID}-refusal']`)).toHaveLength(1);
    expect(banner()).toBeNull();
  });

  it("keeps the notice and shows no banner when the rejection after a refusal event is generic", async () => {
    mount(SLOT);
    await send();
    await runErrorEvent(httpRefusal(MONTHLY));
    await endRun(new Error("network down"));
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(banner()).toBeNull();
  });

  it("falls back to the banner for a refusal code the slot doesn't list", async () => {
    mount(SLOT);
    await send();
    await runErrorEvent(httpRefusal({ error: "server_busy", message: "The demo server is at capacity right now. Try again in a minute." }));
    await endRun("resolve");
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(notice()).toBeNull();
    expect(el(`${SID}-error-text`)).toHaveTextContent("Something went wrong talking to the agent.");
  });

  it("shows today's banner copy for a refusal when no slot is set", async () => {
    mount();
    await send();
    await runErrorEvent(httpRefusal(MONTHLY));
    await endRun("resolve");
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(notice()).toBeNull();
    expect(el(`${SID}-error`)).toHaveAttribute("role", "alert");
    expect(el(`${SID}-error-text`)).toHaveTextContent(`Something went wrong talking to the agent. ${httpRefusal(MONTHLY)}`);
  });

  it("shows today's banner when the platform has no runRefusal slot", async () => {
    mount({});
    await send();
    await endRun(new Error(httpRefusal(MONTHLY)));
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(notice()).toBeNull();
  });

  it("keeps the banner for ordinary run errors even with the slot", async () => {
    mount(SLOT);
    await send();
    await runErrorEvent("the model failed", "MODEL_ERROR");
    await endRun("resolve");
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(el(`${SID}-error-text`)).toHaveTextContent("The model hit an error.");
    expect(notice()).toBeNull();
  });

  it("sends again from the notice and clears it", async () => {
    mount(SLOT);
    await send();
    await runErrorEvent(httpRefusal(MONTHLY));
    await endRun("resolve");
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(runAgent).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(el(`${SID}-refusal-again`)!));
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(notice()).toBeNull();
  });

  it("dismisses the notice", async () => {
    mount(SLOT);
    await send();
    await runErrorEvent(httpRefusal(MONTHLY));
    await endRun("resolve");
    await waitFor(() => expect(notice()).not.toBeNull());
    await act(async () => fireEvent.click(el(`${SID}-refusal-close`)!));
    expect(notice()).toBeNull();
    expect(banner()).toBeNull();
  });

  it("clears the notice when the user sends a new message", async () => {
    mount(SLOT);
    await send();
    await runErrorEvent(httpRefusal(MONTHLY));
    await endRun("resolve");
    await waitFor(() => expect(notice()).not.toBeNull());
    await send("Try again please.");
    expect(notice()).toBeNull();
  });
});
