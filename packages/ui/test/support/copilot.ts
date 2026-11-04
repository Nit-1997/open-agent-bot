import { vi } from "vitest";

type Subscriber = {
  onRunStartedEvent?: (p: { event: unknown }) => void;
  onEvent?: (p: { event: { type: string } }) => void;
  onRunErrorEvent?: (p: { event: { code?: string; message?: string } }) => void;
  onCustomEvent?: (p: { event: { name: string; value: unknown } }) => void;
  onToolCallStartEvent?: (p: { event: { toolCallId: string; toolCallName: string } }) => void;
  onToolCallEndEvent?: (p: { event: { toolCallId: string }; toolCallName: string; toolCallArgs: Record<string, unknown> }) => void;
  onToolCallResultEvent?: (p: { event: { toolCallId: string; content: string } }) => void;
};

export class FakeAgent {
  messages: Array<{ id: string; role: string; content: string }> = [];
  isRunning = false;
  subscribers = new Set<Subscriber>();
  constructor(readonly agentId: string) {}
  subscribe(s: Subscriber) {
    this.subscribers.add(s);
    return { unsubscribe: () => this.subscribers.delete(s) };
  }
  setMessages(m: FakeAgent["messages"]) {
    this.messages = m;
  }
  addMessage(m: FakeAgent["messages"][number]) {
    this.messages = [...this.messages, m];
  }
  emit(type: string, extra: Record<string, unknown> = {}) {
    for (const s of this.subscribers) {
      if (type === "RUN_STARTED") s.onRunStartedEvent?.({ event: { type } });
      if (type === "RUN_ERROR") s.onRunErrorEvent?.({ event: { code: "MODEL_ERROR", message: "boom", ...extra } });
      s.onEvent?.({ event: { type, ...extra } });
    }
  }
  toolCall(toolCallId: string, name: string, args: Record<string, unknown>, result: string) {
    for (const s of this.subscribers) {
      s.onToolCallStartEvent?.({ event: { toolCallId, toolCallName: name } });
      s.onToolCallEndEvent?.({ event: { toolCallId }, toolCallName: name, toolCallArgs: args });
      s.onToolCallResultEvent?.({ event: { toolCallId, content: result } });
    }
  }
}

export const copilot = {
  agents: new Map<string, FakeAgent>(),
  runs: [] as Array<{ agent: FakeAgent; finish: () => void }>,
  contexts: new Map<string, { description: string; value: string; agentIds?: string[] }>(),
  reset() {
    copilot.agents.clear();
    copilot.runs = [];
    copilot.contexts.clear();
  },
};

let n = 0;
const core = {
  addContext: (c: { description: string; value: string; agentIds?: string[] }) => {
    const id = `ctx-${++n}`;
    copilot.contexts.set(id, c);
    return id;
  },
  removeContext: (id: string) => copilot.contexts.delete(id),
  runAgent: vi.fn(
    ({ agent }: { agent: FakeAgent }) =>
      new Promise<void>((resolve) => {
        copilot.runs.push({ agent, finish: resolve });
      }),
  ),
  stopAgent: vi.fn(),
};

export const copilotMock = () => ({
  useAgent: ({ agentId }: { agentId: string }) => {
    let a = copilot.agents.get(agentId);
    if (!a) {
      a = new FakeAgent(agentId);
      copilot.agents.set(agentId, a);
    }
    return { agent: a };
  },
  useCopilotKit: () => ({ copilotkit: core }),
});
