import { type BaseEvent, EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { aguiRoutes } from "../../src/http/agui.js";
import { SessionStore } from "../../src/session/sessionStore.js";

const store = new SessionStore({
  idleMs: 1000,
  create: async () => {
    throw new Error("unused");
  },
});
const input = {
  threadId: "t",
  runId: "r",
  messages: [{ id: "m", role: "user", content: "hi" }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
};

async function* slowRun(): AsyncIterable<BaseEvent> {
  yield { type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as BaseEvent;
  await new Promise((r) => setTimeout(r, 60));
  yield { type: EventType.RUN_FINISHED, threadId: "t", runId: "r" } as BaseEvent;
}

describe("agui route", () => {
  it("keeps a quiet stream alive with SSE comments so clients don't time out mid-turn", async () => {
    const app = aguiRoutes({ store, authorized: () => true, heartbeatMs: 10, handle: slowRun });
    const res = await app.request("/agui", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json", accept: "text/event-stream" },
    });
    const text = await res.text();
    expect(text.match(/^: ping$/gm)?.length).toBeGreaterThanOrEqual(2);
    expect(text.indexOf("RUN_STARTED")).toBeLessThan(text.indexOf(": ping"));
    expect(text.trimEnd().endsWith("}")).toBe(true);
  });

  it("stops beating without throwing when the client disconnects mid-turn", async () => {
    const errors: unknown[] = [];
    const onError = (e: unknown) => errors.push(e);
    process.on("uncaughtException", onError);
    try {
      const app = aguiRoutes({ store, authorized: () => true, heartbeatMs: 5, handle: slowRun });
      const res = await app.request("/agui", {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json", accept: "text/event-stream" },
      });
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      await new Promise((r) => setTimeout(r, 100));
      expect(errors).toEqual([]);
    } finally {
      process.off("uncaughtException", onError);
    }
  });
});
