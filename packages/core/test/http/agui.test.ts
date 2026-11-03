import { type BaseEvent, EventType } from "@ag-ui/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { RunContext } from "../../src/agui/runHandler.js";
import type { AuthEnv, Principal } from "../../src/identity/types.js";
import { aguiRoutes } from "../../src/http/agui.js";
import { ConcurrencyGate, RateLimiter, rateLimitError } from "../../src/lib/rateLimit.js";
import { LocalRunPolicy } from "../../src/policy/localRunPolicy.js";
import type { Admission, RunPolicy, RunRequest } from "../../src/policy/types.js";
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

type RouteOpts = {
  heartbeatMs: number;
  gate?: ConcurrencyGate;
  limiter?: RateLimiter;
  policy?: RunPolicy;
  context?: (user: Principal, chatId: string) => RunContext;
  handle?: typeof slowRun;
};

function routes(opts: RouteOpts) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("user", ALICE);
    await next();
  });
  app.route(
    "/",
    aguiRoutes({
      store,
      context: opts.context ?? (() => ({}) as never),
      policy: opts.policy ?? new LocalRunPolicy({ limiter: opts.limiter ?? new RateLimiter(), gate: opts.gate ?? new ConcurrencyGate(2) }),
      heartbeatMs: opts.heartbeatMs,
      handle: opts.handle ?? slowRun,
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

function recordingPolicy(inner: RunPolicy = new LocalRunPolicy({ limiter: new RateLimiter(), gate: new ConcurrencyGate(2) })) {
  const ends: number[] = [];
  const requests: RunRequest[] = [];
  const policy: RunPolicy = {
    async admit(run) {
      requests.push(run);
      const admission = await inner.admit(run);
      if (!admission.ok) return admission;
      const index = ends.push(0) - 1;
      return {
        ok: true,
        ticket: {
          end() {
            ends[index]++;
            admission.ticket.end();
          },
        },
      };
    },
  };
  return { policy, ends, requests };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

async function* throwingRun(): AsyncIterable<BaseEvent> {
  yield { type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as BaseEvent;
  throw new Error("handle failed");
}

async function* waitForAbort(_input: unknown, _ctx: unknown, _store: unknown, signal: AbortSignal): AsyncIterable<BaseEvent> {
  yield { type: EventType.RUN_STARTED, threadId: "t", runId: "r" } as BaseEvent;
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

describe("agui run tickets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("admits with the principal, chat and run id", async () => {
    const { policy, requests } = recordingPolicy();
    await (await post(routes({ heartbeatMs: 1000, policy }))).text();
    expect(requests).toEqual([{ principal: ALICE, chatId: CHAT_1, runId: "r" }]);
  });

  it("ends the ticket once when the stream finishes", async () => {
    const { policy, ends } = recordingPolicy();
    const res = await post(routes({ heartbeatMs: 1000, policy }));
    expect(await res.text()).toContain("RUN_FINISHED");
    await settle();
    expect(ends).toEqual([1]);
  });

  it("ends the ticket once when the client cancels", async () => {
    const { policy, ends } = recordingPolicy();
    const res = await post(routes({ heartbeatMs: 1000, policy, handle: waitForAbort as typeof slowRun }));
    const reader = res.body!.getReader();
    await reader.read();
    expect(ends).toEqual([0]);
    await reader.cancel();
    await settle();
    expect(ends).toEqual([1]);
  });

  it("ends the ticket once when handle throws", async () => {
    const { policy, ends } = recordingPolicy();
    const res = await post(routes({ heartbeatMs: 1000, policy, handle: throwingRun }));
    await res.text().catch(() => "");
    await settle();
    expect(ends).toEqual([1]);
  });

  it("returns the refusal and never builds a context or calls handle when admission is refused", async () => {
    const context = vi.fn(() => ({}) as never);
    const handle = vi.fn(slowRun);
    const refusal: Admission = { ok: false, error: rateLimitError(7) };
    const policy: RunPolicy = { admit: vi.fn(async () => refusal) };
    const res = await post(routes({ heartbeatMs: 1000, policy, context, handle }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toEqual({ error: "rate_limited", message: "Slow down: try again in 7 s.", retryAfter: 7 });
    expect(policy.admit).toHaveBeenCalledTimes(1);
    expect(context).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it("ends the ticket when the run context throws, then admits two runs at once", async () => {
    const { policy, ends } = recordingPolicy();
    let calls = 0;
    const context = () => {
      if (calls++ === 0) throw new Error("context failed");
      return {} as never;
    };
    const app = routes({ heartbeatMs: 1000, policy, context });
    const failed = await post(app);
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("Internal Server Error");
    expect(ends).toEqual([1]);
    const [a, b] = [await post(app), await post(app)];
    expect([a.status, b.status]).toEqual([200, 200]);
    await Promise.all([a.text(), b.text()]);
  });

  it("ends the ticket when the stream setup throws, then admits two runs at once", async () => {
    const { policy, ends } = recordingPolicy();
    const Real = globalThis.ReadableStream;
    let armed = false;
    vi.stubGlobal(
      "ReadableStream",
      new Proxy(Real, {
        construct(target, args) {
          if (armed) {
            armed = false;
            throw new Error("stream setup failed");
          }
          return Reflect.construct(target, args);
        },
      }),
    );
    let calls = 0;
    const context = () => {
      if (calls++ === 0) armed = true;
      return {} as never;
    };
    const app = routes({ heartbeatMs: 1000, policy, context });
    const failed = await post(app);
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("Internal Server Error");
    expect(ends).toEqual([1]);
    const [a, b] = [await post(app), await post(app)];
    expect([a.status, b.status]).toEqual([200, 200]);
    await Promise.all([a.text(), b.text()]);
  });
});
