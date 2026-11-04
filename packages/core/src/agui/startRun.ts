import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { isUuid } from "@oab/shared/ids";
import type { Principal } from "../identity/types.js";
import { UserError } from "../lib/errors.js";
import { type RunPolicy, refundLatch } from "../policy/types.js";
import type { SessionStore } from "../session/sessionStore.js";
import { handleRun, type RunContext } from "./runHandler.js";

export type RunHandle = { events: AsyncIterator<BaseEvent>; close(): void };

export type StartRunResult = { ok: false; error: UserError } | { ok: true; run: RunHandle };

export type StartRunOptions = { signal?: AbortSignal; onClaimed?: (threadId: string) => void };

export type RunDeps = {
  store: SessionStore;
  context: (user: Principal, chatId: string) => RunContext;
  policy: RunPolicy;
  handle?: typeof handleRun;
};

const RUN_ID_RE = /^[\w-]{1,100}$/;

export function isRunInput(x: unknown): x is RunAgentInput {
  const v = x as Partial<RunAgentInput> | null;
  return !!v && isUuid(v.threadId) && typeof v.runId === "string" && RUN_ID_RE.test(v.runId) && Array.isArray(v.messages);
}

function reportClaims(ctx: RunContext, onClaimed: (threadId: string) => void): RunContext {
  const chats = ctx.chats;
  return {
    ...ctx,
    chats: {
      claim: async (chatId, opts) => {
        await chats.claim(chatId, opts);
        onClaimed(chatId);
      },
      touch: (chatId, opts) => chats.touch(chatId, opts),
    },
  };
}

export async function startRun(
  deps: RunDeps,
  principal: Principal,
  input: RunAgentInput,
  opts: StartRunOptions = {},
): Promise<StartRunResult> {
  if (!isRunInput(input)) return { ok: false, error: new UserError("invalid RunAgentInput", "invalid") };
  const admission = await deps.policy.admit({ principal, chatId: input.threadId, runId: input.runId });
  if (!admission.ok) return admission;
  const { ticket } = admission;

  const latch = refundLatch(() => ticket.refund?.());
  let ended = false;
  const settle = () => {
    latch.refund();
    if (ended) return;
    ended = true;
    ticket.end();
  };

  const ac = new AbortController();
  let inner: AsyncIterator<BaseEvent> | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    opts.signal?.removeEventListener("abort", close);
    ac.abort();
    if (!inner) {
      ended = true;
      ticket.end();
      return;
    }
    void Promise.resolve(inner.return?.())
      .catch(() => {})
      .finally(settle);
  };

  try {
    const base = deps.context(principal, input.threadId);
    const withClaims = opts.onClaimed ? reportClaims(base, opts.onClaimed) : base;
    inner = (deps.handle ?? handleRun)(input, { ...withClaims, refund: latch }, deps.store, ac.signal)[Symbol.asyncIterator]();
  } catch (err) {
    close();
    throw err;
  }
  const source = inner;
  const events: AsyncIterator<BaseEvent> = {
    async next() {
      try {
        const step = await source.next();
        if (step.done) settle();
        return step;
      } catch (err) {
        settle();
        throw err;
      }
    },
    async return(value?: unknown) {
      try {
        return (await source.return?.(value)) ?? { done: true, value: undefined };
      } finally {
        settle();
      }
    },
  };
  if (opts.signal?.aborted) close();
  else opts.signal?.addEventListener("abort", close, { once: true });
  return { ok: true, run: { events, close } };
}
