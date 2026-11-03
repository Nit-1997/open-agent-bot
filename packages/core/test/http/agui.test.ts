import { type BaseEvent, EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AuthEnv } from "../../src/identity/types.js";
import { aguiRoutes } from "../../src/http/agui.js";
import { ConcurrencyGate, RateLimiter } from "../../src/lib/rateLimit.js";
import { SessionStore } from "../../src/session/sessionStore.js";
import { ALICE, CHAT_1 } from "../fixtures/users.js";

const store = new SessionStore({
  idleMs: 1000,
  create: async () => {
    throw new Error("unused");
  },
});
const input = {
  threadId: CHAT_1,
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

function routes(opts: { heartbeatMs: number; gate?: ConcurrencyGate; limiter?: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("user", ALICE);
    await next();
  });
  app.route(
    "/",
    aguiRoutes({
      store,
      context: () => ({}) as never,
      limiter: opts.limiter ?? new RateLimiter(),
      gate: opts.gate ?? new ConcurrencyGate(2),
      heartbeatMs: opts.heartbeatMs,
      handle: slowRun,
    }),
  );
  return app;
}

const post = (app: ReturnType<typeof routes>) =>
  app.request("/agui", {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", accept: "text/event-stream" },
  });

describe("agui route", () => {
  it.each([["r\n[auth] forged"], ["x".repeat(101)], [""], ["a b"]])("refuses run id %j before anything is logged", async (runId) => {
    const res = await routes({ heartbeatMs: 1000 }).request("/agui", {
      method: "POST",
      body: JSON.stringify({ ...input, runId }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid" });
  });

  it("keeps a quiet stream alive with SSE comments so clients don't time out mid-turn", async () => {
    const res = await post(routes({ heartbeatMs: 10 }));
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
      const res = await post(routes({ heartbeatMs: 5 }));
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      await new Promise((r) => setTimeout(r, 100));
      expect(errors).toEqual([]);
    } finally {
      process.off("uncaughtException", onError);
    }
  });

  it("allows two runs at once per user and answers 429 for a third", async () => {
    const app = routes({ heartbeatMs: 1000 });
    const first = await post(app);
    const second = await post(app);
    const third = await post(app);
    expect(third.status).toBe(429);
    await Promise.all([first.text(), second.text()]);
    expect((await post(app)).status).toBe(200);
  });

  it("caps runs per user over ten minutes", async () => {
    const limiter = new RateLimiter();
    const app = routes({ heartbeatMs: 1000, limiter, gate: new ConcurrencyGate(100) });
    for (let i = 0; i < 30; i++) await (await post(app)).text();
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
  });
});
