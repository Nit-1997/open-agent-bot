import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { type Mock, vi } from "vitest";
import type { RunContext } from "../../src/agui/runHandler.js";
import { type RunDeps, type RunHandle, startRun } from "../../src/agui/startRun.js";
import type { Principal } from "../../src/identity/types.js";
import type { Admission, RunPolicy, RunRequest } from "../../src/policy/types.js";
import { type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";
import { WorkspaceStore } from "../../src/workspace/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ev, fakeSession, type Script } from "./fakeSession.js";

export const say: Script = async (emit) => {
  emit(ev.assistantStart);
  emit(ev.delta("hi"));
  emit(ev.assistantEnd());
};

export const holdUntilAbort: Script = async (emit, ctl) => {
  emit(ev.assistantStart);
  emit(ev.delta("working"));
  while (!ctl.aborted()) await new Promise((r) => setTimeout(r, 5));
  emit(ev.assistantEnd("aborted"));
};

export const toolCallOf =
  (ms: number): Script =>
  async (emit) => {
    emit(ev.assistantStart);
    emit(ev.delta("calling a tool"));
    await new Promise((r) => setTimeout(r, ms));
    emit(ev.assistantEnd());
  };

export function runInput(threadId: string, runId: string, text = "hello"): RunAgentInput {
  return {
    threadId,
    runId,
    messages: [{ id: `m-${runId}`, role: "user", content: text }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  } as RunAgentInput;
}

export type RecordedTicket = { request: RunRequest; end: Mock<() => void>; refund: Mock<() => void> };

export class RecordingPolicy implements RunPolicy {
  readonly tickets: RecordedTicket[] = [];

  async admit(request: RunRequest): Promise<Admission> {
    const t: RecordedTicket = { request, end: vi.fn<() => void>(), refund: vi.fn<() => void>() };
    this.tickets.push(t);
    return { ok: true, ticket: { end: t.end, refund: t.refund } };
  }
}

export type RunWorldOptions = {
  policy: RunPolicy;
  script?: Script;
  limits?: { perUser?: number; total?: number };
  context?: (user: Principal, chatId: string) => RunContext;
};

export function runWorld(opts: RunWorldOptions) {
  const db = new MemoryDb();
  const created: SessionEntry[] = [];
  const store = new SessionStore({
    idleMs: 60_000,
    limits: opts.limits,
    create: async (): Promise<SessionEntry> => {
      const e: SessionEntry = {
        session: fakeSession(opts.script ?? say),
        busy: false,
        lastUsed: 0,
        dispose: async () => {},
        workspace: new WorkspaceStore(),
      };
      created.push(e);
      return e;
    },
  });
  const context =
    opts.context ??
    ((user: Principal): RunContext => {
      const r = db.forUser(user.id);
      return { user, chats: r.chats, messages: r.messages, timeLimitMs: 60_000 };
    });
  const deps: RunDeps = { store, context, policy: opts.policy };
  const start = (user: Principal, chatId: string, runId: string, signal?: AbortSignal) =>
    startRun(deps, user, runInput(chatId, runId), signal ? { signal } : {});
  return { db, store, deps, created, start };
}

export async function pullUntil(run: RunHandle, type: EventType): Promise<BaseEvent[]> {
  const seen: BaseEvent[] = [];
  for (;;) {
    const next = await run.events.next();
    if (next.done) return seen;
    seen.push(next.value);
    if (next.value.type === type) return seen;
  }
}

export async function drain(run: RunHandle): Promise<BaseEvent[]> {
  const seen: BaseEvent[] = [];
  for (let next = await run.events.next(); !next.done; next = await run.events.next()) seen.push(next.value);
  return seen;
}

export const errorCodes = (events: BaseEvent[]) =>
  events.filter((e) => e.type === EventType.RUN_ERROR).map((e) => (e as BaseEvent & { code?: string }).code);

export const flush = () => new Promise((r) => setTimeout(r, 0));
