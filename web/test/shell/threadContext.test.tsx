import { HttpAgent } from "@ag-ui/client";
import { CopilotKitCore } from "@copilotkit/core";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadContext } from "@/lib/useThreadContext";

const core = new CopilotKitCore({ deferInitialConnection: true });

vi.mock("@copilotkit/react-core/v2", () => ({ useCopilotKit: () => ({ copilotkit: core }) }));

function Pane({ thread, model, edits }: { thread: string; model: string; edits: string }) {
  useThreadContext(`chat-${thread}`, "user_context", JSON.stringify({ model }));
  useThreadContext(`chat-${thread}`, "workspace_edits", edits);
  return <p id={`pane-${thread}`}>{thread}</p>;
}

const valuesFor = (agentId: string) => core.getContextForAgent(agentId).map((c) => [c.description, c.value]);

afterEach(() => vi.unstubAllGlobals());

describe("useThreadContext against the real CopilotKit core", () => {
  it("gives each agent only its own pane's context and removes it on unmount", () => {
    const { rerender } = render(
      <>
        <Pane thread="A" model="m-a" edits='{"cart":{"removed":["a"]}}' />
        <Pane thread="B" model="m-b" edits='{"cart":{"removed":["b"]}}' />
      </>,
    );
    expect(valuesFor("chat-A")).toEqual([
      ["user_context", '{"model":"m-a"}'],
      ["workspace_edits", '{"cart":{"removed":["a"]}}'],
    ]);
    expect(valuesFor("chat-B")).toEqual([
      ["user_context", '{"model":"m-b"}'],
      ["workspace_edits", '{"cart":{"removed":["b"]}}'],
    ]);
    rerender(<Pane thread="A" model="m-a" edits='{"cart":{"removed":["a"]}}' />);
    expect(valuesFor("chat-B")).toEqual([]);
    expect(valuesFor("chat-A")).toHaveLength(2);
  });

  it("sends each run request only its own context", async () => {
    const bodies: Array<{ threadId: string; context: Array<{ description: string; value: string }> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        const events = [
          { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
          { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
        ];
        return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    render(
      <>
        <Pane thread="A" model="m-a" edits="" />
        <Pane thread="B" model="m-b" edits='{"trip":{"travelers":3}}' />
      </>,
    );
    const agentA = new HttpAgent({ agentId: "chat-A", url: "https://app.test/api/copilotkit/agent/openagent/run", threadId: "A" });
    const agentB = new HttpAgent({ agentId: "chat-B", url: "https://app.test/api/copilotkit/agent/openagent/run", threadId: "B" });
    await core.runAgent({ agent: agentA });
    await core.runAgent({ agent: agentB });
    expect(bodies.map((b) => [b.threadId, b.context.map((c) => `${c.description}=${c.value}`)])).toEqual([
      ["A", ['user_context={"model":"m-a"}', "workspace_edits="]],
      ["B", ['user_context={"model":"m-b"}', 'workspace_edits={"trip":{"travelers":3}}']],
    ]);
  });
});
