import { HttpAgent } from "@ag-ui/client";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { ɵGLOBAL_STORE } from "@copilotkit/runtime/v2";
import type { handleRun, RunContext } from "../../src/agui/runHandler.js";
import type { RunDeps } from "../../src/agui/startRun.js";
import { CoreRunAgent, coreAgentFactory } from "../../src/copilot/coreRunAgent.js";
import { ConnectSlots, ThreadOwners } from "../../src/copilot/owners.js";
import type { Principal } from "../../src/identity/types.js";
import { UserError } from "../../src/lib/errors.js";
import { ConcurrencyGate, RateLimiter } from "../../src/lib/rateLimit.js";
import { LocalRunPolicy } from "../../src/policy/localRunPolicy.js";
import type { Admission, RunPolicy, RunRequest } from "../../src/policy/types.js";
import { SessionStore } from "../../src/session/sessionStore.js";
import { type IdentitySeams, makeApp, tokenFor } from "../fixtures/app.js";
import { TEST_SECRET } from "../fixtures/config.js";

export const T1 = "0b7c3f5e-3a52-4f8b-9a6e-8f1c2d3e4f50";
export const T2 = "1c8d4a6f-4b63-4a9c-8b7f-9a2d3e4f5a61";
export const T3 = "2d9e5b7a-5c74-4bad-9c8a-ab3e4f5a6b72";

export type Handle = typeof handleRun;

export class Deferred<T = void> {
  resolve!: (v: T) => void;
  reject!: (e: unknown) => void;
  readonly promise = new Promise<T>((res, rej) => {
    this.resolve = res;
    this.reject = rej;
  });
}

export class CountingGate extends ConcurrencyGate {
  active = 0;

  enter(key: string): (() => void) | undefined {
    const leave = super.enter(key);
    if (!leave) return undefined;
    this.active++;
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.active--;
      leave();
    };
  }
}

export class SwitchPolicy implements RunPolicy {
  refuse?: UserError;
  readonly requests: RunRequest[] = [];

  constructor(readonly inner: RunPolicy) {}

  async admit(run: RunRequest): Promise<Admission> {
    this.requests.push(run);
    if (this.refuse) return { ok: false, error: this.refuse };
    return this.inner.admit(run);
  }
}

export const busyError = () => new UserError("The agent is busy. Try again in a moment.", "rate_limited", { code: "busy", retryAfter: 5 });

const ev = (e: Record<string, unknown>) => e as unknown as BaseEvent;
export const started = (i: RunAgentInput) => ev({ type: EventType.RUN_STARTED, threadId: i.threadId, runId: i.runId });
export const finished = (i: RunAgentInput) => ev({ type: EventType.RUN_FINISHED, threadId: i.threadId, runId: i.runId });
export const text = (id: string, delta: string) => ev({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: id, delta });
export const textStart = (id: string) => ev({ type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" });
export const textEnd = (id: string) => ev({ type: EventType.TEXT_MESSAGE_END, messageId: id });
export const runError = (code: string, message: string) => ev({ type: EventType.RUN_ERROR, code, message });

export const until = (signal: AbortSignal, ms: number) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export type Mode = "in-process" | "loopback";

export type HarnessOptions = {
  handle: Handle;
  mode?: Mode;
  connectsPerUser?: number;
  connectMaxMs?: number;
  heartbeatMs?: number;
  seams?: IdentitySeams;
  owners?: ThreadOwners;
  gate?: CountingGate;
  agentUrl?: () => string;
};

export async function copilotHarness(opts: HarnessOptions) {
  ɵGLOBAL_STORE.clear();
  const limiter = new RateLimiter();
  const gate = opts.gate ?? new CountingGate(8);
  const policy = new SwitchPolicy(new LocalRunPolicy({ limiter, gate }));
  const store = new SessionStore({
    idleMs: 60_000,
    create: async () => {
      throw new Error("no sessions in this harness");
    },
  });
  const owners = opts.owners ?? new ThreadOwners();
  const slots = new ConnectSlots(opts.connectsPerUser ?? 8);
  const contexts: RunContext[] = [];
  const agents: unknown[] = [];
  let h: Awaited<ReturnType<typeof makeApp>> | undefined;
  const context = (user: Principal): RunContext => {
    const repos = h!.db.forUser(user.id);
    const ctx: RunContext = { user, chats: repos.chats, messages: repos.messages, timeLimitMs: 60_000 };
    contexts.push(ctx);
    return ctx;
  };
  const run: RunDeps = { store, context, policy, handle: opts.handle };
  const inProcess = coreAgentFactory({ run, owners });
  const loopback = (principal: Principal) =>
    new HttpAgent({
      url: `${opts.agentUrl?.() ?? "http://agent.test"}/agui`,
      headers: { "x-agent-secret": TEST_SECRET, authorization: `Bearer ${tokenFor(principal)}` },
    });
  const agent = (principal: Principal) => {
    const made = opts.mode === "loopback" ? loopback(principal) : inProcess(principal);
    agents.push(made);
    return made;
  };
  h = await makeApp({
    runPolicy: policy,
    limiter,
    store,
    runContext: context,
    handleRun: opts.handle,
    seams: opts.seams,
    copilot: {
      agent,
      owners,
      chatExists: (userId, threadId) => h!.db.forUser(userId).chats.exists(threadId),
      slots,
      connectMaxMs: opts.connectMaxMs ?? 60_000,
      heartbeatMs: opts.heartbeatMs,
    },
  });
  return { ...h, policy, gate, owners, slots, contexts, agents, limiter, isCore: (a: unknown) => a instanceof CoreRunAgent };
}

export type CopilotHarness = Awaited<ReturnType<typeof copilotHarness>>;

export const runBody = (threadId: unknown, extra: Record<string, unknown> = {}) => ({
  threadId,
  runId: `r-${Math.random().toString(36).slice(2, 10)}`,
  messages: [{ id: `m-${Math.random().toString(36).slice(2, 10)}`, role: "user", content: "hello" }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
  ...extra,
});

export const RUN = "/copilotkit/agent/openagent/run";
export const CONNECT = "/copilotkit/agent/openagent/connect";
export const STOP = (threadId: string) => `/copilotkit/agent/openagent/stop/${threadId}`;

export function post(h: CopilotHarness, user: Principal, path: string, body: unknown) {
  return h.call(user, path, {
    method: "POST",
    headers: { accept: "text/event-stream" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export type SseEvent = { type: string; code?: string; message?: string; [k: string]: unknown };

export function parseSse(text: string): SseEvent[] {
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => !!line)
    .map((line) => JSON.parse(line.slice("data: ".length)) as SseEvent);
}

export async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, seen: (text: string) => boolean): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!seen(text)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

export const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await settle(5);
  }
}

export type RunControl = { holds?: Map<string, Deferred>; seen?: Array<{ user: string; threadId: string }> };

export function fakeRun(control: RunControl = {}): Handle {
  return async function* (input: RunAgentInput, ctx: RunContext, _store: unknown, signal: AbortSignal) {
    control.seen?.push({ user: ctx.user.id, threadId: input.threadId });
    yield started(input);
    try {
      await ctx.chats.claim(input.threadId, {});
    } catch {
      yield runError("NOT_FOUND", "This chat doesn't exist.");
      return;
    }
    const id = `msg-${input.runId}`;
    yield textStart(id);
    yield text(id, `Hello ${ctx.user.id}`);
    const hold = control.holds?.get(input.threadId);
    if (hold) await Promise.race([hold.promise, until(signal, 60_000)]);
    if (signal.aborted) return;
    yield text(id, " world");
    yield textEnd(id);
    yield finished(input);
  } as Handle;
}
