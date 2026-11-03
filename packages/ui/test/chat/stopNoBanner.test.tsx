import { AbstractAgent, type BaseEvent, EventType } from "@ag-ui/client";
import { DEFAULT_AGENT } from "@oab/shared/profile";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { EMPTY, type Observable } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSession } from "@/components/chat/ChatSession";

class FakeAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}

const mounted: { agent?: FakeAgent } = {};
const runs: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
const runAgent = vi.fn(() => new Promise<void>((resolve, reject) => runs.push({ resolve, reject })));
const stopAgent = vi.fn();

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => {
    const [agent] = useState(() => new FakeAgent());
    mounted.agent = agent;
    return { agent };
  },
  useCopilotKit: () => ({ copilotkit: { addContext: () => "ctx", removeContext: () => {}, runAgent, stopAgent } }),
}));

const SID = "stopped";
const el = (id: string) => document.getElementById(id);
const banner = () => document.querySelector(`[id$='-error'][role=alert]`);

function mount() {
  return render(
    <ChatSession
      id={SID}
      agentId="openagent"
      threadId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
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
  );
}

async function startStreaming() {
  const input = el(`${SID}-composer-input`) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "Write an essay about lighthouses." } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(el(`${SID}-composer-stop`)).not.toBeNull());
  await act(async () => {
    mounted.agent!.addMessages([{ id: "reply-1", role: "assistant", content: "Lighthouses have guided" }]);
  });
}

async function runError(code: string, message: string) {
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

const clickStop = () => act(async () => fireEvent.click(el(`${SID}-composer-stop`)!));
const abortError = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

beforeEach(() => {
  runs.length = 0;
  runAgent.mockClear();
  stopAgent.mockClear();
});

describe("stopping a reply", () => {
  it("shows no error banner when the user stops and the run ends in an abort", async () => {
    mount();
    await startStreaming();
    await clickStop();
    expect(stopAgent).toHaveBeenCalledTimes(1);
    await runError("abort", "This operation was aborted");
    await endRun("resolve");
    await waitFor(() => expect(el(`${SID}-composer-stop`)).toBeNull());
    expect(banner()).toBeNull();
    expect(el(`${SID}-turns`)?.textContent).toContain("Lighthouses have guided");
  });

  it("shows no error banner when the stopped run rejects with an abort", async () => {
    mount();
    await startStreaming();
    await clickStop();
    await endRun(abortError());
    await waitFor(() => expect(el(`${SID}-composer-stop`)).toBeNull());
    expect(banner()).toBeNull();
  });

  it("still shows the banner for an abort the user did not ask for", async () => {
    mount();
    await startStreaming();
    await runError("abort", "This operation was aborted");
    await endRun("resolve");
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(banner()?.id).toBe(`${SID}-error`);
  });

  it("still shows the banner for a rejected abort without a stop", async () => {
    mount();
    await startStreaming();
    await endRun(abortError());
    await waitFor(() => expect(banner()).not.toBeNull());
  });

  it("still shows the banner for a model error after a stop", async () => {
    mount();
    await startStreaming();
    await clickStop();
    await runError("MODEL_ERROR", "the model failed");
    await endRun("resolve");
    await waitFor(() => expect(banner()).not.toBeNull());
  });

  it("forgets the stop once the user sends again", async () => {
    mount();
    await startStreaming();
    await clickStop();
    await runError("abort", "This operation was aborted");
    await endRun("resolve");
    await waitFor(() => expect(el(`${SID}-composer-stop`)).toBeNull());
    await startStreaming();
    await runError("abort", "This operation was aborted");
    await endRun("resolve");
    await waitFor(() => expect(banner()).not.toBeNull());
  });
});
