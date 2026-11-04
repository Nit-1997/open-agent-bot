import { AbstractAgent, type BaseEvent } from "@ag-ui/client";
import { DEFAULT_AGENT } from "@oab/shared/profile";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { EMPTY, type Observable } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSession } from "../../src/components/chat/ChatSession.tsx";
import { useRunSettled } from "../../src/platform/index.ts";
import { noteRunSettled } from "../../src/platform/runSettled.ts";

class FakeAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}

const runs: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
const runAgent = vi.fn(() => new Promise<void>((resolve, reject) => runs.push({ resolve, reject })));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => {
    const [agent] = useState(() => new FakeAgent());
    return { agent };
  },
  useCopilotKit: () => ({ copilotkit: { addContext: () => "ctx", removeContext: () => {}, runAgent, stopAgent: vi.fn() } }),
}));

const el = (id: string) => document.getElementById(id);

function Counter({ id }: { id: string }) {
  return <output id={id}>{useRunSettled()}</output>;
}

const value = (id: string) => Number(el(id)?.textContent);

beforeEach(() => {
  runs.length = 0;
  runAgent.mockClear();
});

describe("useRunSettled", () => {
  it("re-renders every reader when a run settles", () => {
    render(
      <>
        <Counter id="settled-a" />
        <Counter id="settled-b" />
      </>,
    );
    const start = value("settled-a");
    expect(value("settled-b")).toBe(start);
    act(() => noteRunSettled());
    expect(value("settled-a")).toBe(start + 1);
    expect(value("settled-b")).toBe(start + 1);
  });

  it("counts each ChatSession run once it settles, after onRunEnd, whether it resolves or rejects", async () => {
    const onRunEnd = vi.fn();
    render(
      <>
        <Counter id="settled-c" />
        <ChatSession
          id="settle"
          agentId="openagent"
          threadId="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
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
          onRunEnd={onRunEnd}
        />
      </>,
    );
    const start = value("settled-c");
    const sendText = async (text: string) => {
      const input = el("settle-composer-input") as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(runAgent).toHaveBeenCalled());
    };

    await sendText("First message.");
    expect(value("settled-c")).toBe(start);
    await act(async () => runs.at(-1)!.resolve());
    await waitFor(() => expect(value("settled-c")).toBe(start + 1));
    expect(onRunEnd).toHaveBeenCalledTimes(1);

    await sendText("Second message.");
    await act(async () => runs.at(-1)!.reject(new Error('HTTP 429: {"error":"limit_hourly","message":"Slow"}')));
    await waitFor(() => expect(value("settled-c")).toBe(start + 2));
    expect(onRunEnd).toHaveBeenCalledTimes(2);
  });
});
