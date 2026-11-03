import { AbstractAgent, type BaseEvent } from "@ag-ui/client";
import { agentPersona } from "@oab/shared/profile";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useReducer, useState } from "react";
import { EMPTY, type Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { ChatSession } from "@/components/chat/ChatSession";
import type { ReportRef } from "@/lib/reportRefs";

class RealAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}

const agents: { provisional?: RealAgent; registered?: RealAgent } = {};

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => {
    const [, force] = useReducer((x: number) => x + 1, 0);
    const [registered, setRegistered] = useState<RealAgent | null>(null);
    useEffect(() => {
      const r = new RealAgent();
      agents.registered = r;
      setRegistered(r);
    }, []);
    agents.provisional ??= new RealAgent();
    const agent = registered ?? agents.provisional;
    useEffect(() => {
      const sub = agent.subscribe({ onMessagesChanged: () => queueMicrotask(force) });
      return () => sub.unsubscribe();
    }, [agent]);
    return { agent };
  },
  useCopilotKit: () => ({ copilotkit: { addContext: () => "ctx", removeContext: () => {}, runAgent: vi.fn(), stopAgent: vi.fn() } }),
}));

const history = [
  { id: "u1", role: "user" as const, content: "plan big sur" },
  {
    id: "a1",
    role: "assistant" as const,
    content: "",
    toolCalls: [
      { id: "c-bigSurStays1", type: "function" as const, function: { name: "create_artifact", arguments: '{"title":"Big Sur stays"}' } },
    ],
  },
  { id: "t1", role: "tool" as const, toolCallId: "c-bigSurStays1", content: "artifact bigSurStays1 created: Big Sur stays" },
  { id: "a2", role: "assistant" as const, content: "Here is the report." },
];

function mount(onReports: (r: ReportRef[]) => void, onReportReady?: (r: unknown) => void) {
  return render(
    <ChatSession
      id="swap"
      agentId="openagent"
      threadId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      locale="en-US"
      persona={agentPersona(undefined)}
      history={history as never}
      composerPlaceholder="Ask"
      composerLabel="Message"
      autoFocus={false}
      emptyHeading="h1"
      memory={null}
      onOpenProfile={() => {}}
      onRunningChange={() => {}}
      onClaimed={() => {}}
      onRunEnd={() => {}}
      onReports={onReports}
      onReportReady={onReportReady}
    />,
  );
}

describe("ChatSession with CopilotKit's provisional-then-registered agent", () => {
  it("renders restored history and reports after the swap, and messages added in place afterwards", async () => {
    agents.provisional = undefined;
    const onReports = vi.fn();
    mount(onReports);
    await waitFor(() => expect(screen.getByText("Here is the report.")).toBeInTheDocument());
    await waitFor(() =>
      expect(onReports).toHaveBeenLastCalledWith([{ reportId: "bigSurStays1", toolCallId: "c-bigSurStays1", title: "Big Sur stays" }]),
    );
    const registered = agents.registered!;
    await act(async () => {
      registered.addMessage({ id: "u2", role: "user", content: "and the gear?" });
    });
    await waitFor(() => expect(screen.getByText("and the gear?")).toBeInTheDocument());
    await act(async () => {
      registered.addMessage({
        id: "a3",
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c-campingGear2", type: "function", function: { name: "create_artifact", arguments: '{"title":"Camping gear"}' } },
        ],
      });
      registered.addMessage({
        id: "t2",
        role: "tool",
        toolCallId: "c-campingGear2",
        content: "artifact campingGear2 created: Camping gear",
      });
    });
    await waitFor(() => expect(onReports.mock.lastCall?.[0]).toHaveLength(2));
  });

  it("forgets a tool call once its result arrives", async () => {
    agents.provisional = undefined;
    const ready = vi.fn();
    mount(vi.fn(), ready);
    await waitFor(() => expect(agents.registered).toBeDefined());
    await waitFor(() => expect(screen.getByText("Here is the report.")).toBeInTheDocument());
    type Handlers = {
      onToolCallStartEvent?: (p: unknown) => void;
      onToolCallEndEvent?: (p: unknown) => void;
      onToolCallResultEvent?: (p: unknown) => void;
    };
    const subs = agents.registered!.subscribers as Handlers[];
    const result = { event: { toolCallId: "c-live", content: "artifact packingList3 created: Packing list" } };
    act(() => {
      for (const s of subs) {
        s.onToolCallStartEvent?.({ event: { toolCallId: "c-live", toolCallName: "create_artifact" } });
        s.onToolCallEndEvent?.({
          event: { toolCallId: "c-live" },
          toolCallName: "create_artifact",
          toolCallArgs: { title: "Packing list" },
        });
        s.onToolCallResultEvent?.(result);
        s.onToolCallResultEvent?.(result);
      }
    });
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith({ reportId: "packingList3", toolCallId: "c-live", title: "Packing list", tool: "create_artifact" });
  });
});
