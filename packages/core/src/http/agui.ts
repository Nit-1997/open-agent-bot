import type { RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { Hono } from "hono";
import { isUuid } from "@oab/shared/ids";
import { handleRun, type RunContext } from "../agui/runHandler.js";
import type { AuthEnv } from "../auth/middleware.js";
import type { AuthUser } from "../auth/verify.js";
import { type ConcurrencyGate, LIMITS, type RateLimiter, rateLimitError } from "../lib/rateLimit.js";
import { UserError } from "../lib/errors.js";
import { errorResponse } from "./handlers.js";
import type { SessionStore } from "../session/sessionStore.js";

const RUN_ID_RE = /^[\w-]{1,100}$/;

function isRunInput(x: unknown): x is RunAgentInput {
  const v = x as Partial<RunAgentInput> | null;
  return !!v && isUuid(v.threadId) && typeof v.runId === "string" && RUN_ID_RE.test(v.runId) && Array.isArray(v.messages);
}

const HEARTBEAT_MS = 15_000;
const HEARTBEAT = new TextEncoder().encode(": ping\n\n");

export function aguiRoutes(deps: {
  store: SessionStore;
  context: (user: AuthUser, chatId: string) => RunContext;
  limiter: RateLimiter;
  gate: ConcurrencyGate;
  heartbeatMs?: number;
  handle?: typeof handleRun;
}) {
  const handle = deps.handle ?? handleRun;
  const app = new Hono<AuthEnv>();

  app.post("/agui", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isRunInput(body)) return errorResponse(c, new UserError("invalid RunAgentInput", "invalid"));
    const user = c.get("user");
    const verdict = deps.limiter.take(`run:${user.id}`, LIMITS.run);
    if (!verdict.ok) return errorResponse(c, rateLimitError(verdict.retryAfter));
    const leave = deps.gate.enter(user.id);
    if (!leave) return errorResponse(c, rateLimitError(5));
    const input: RunAgentInput = { ...body, threadId: body.threadId.toLowerCase() };
    const ctx = deps.context(user, input.threadId);

    const encoder = new EventEncoder({ accept: c.req.header("accept") });
    const ac = new AbortController();
    c.req.raw.signal?.addEventListener("abort", () => ac.abort(), { once: true });
    const textEncoder = new TextEncoder();
    const sse = encoder.getContentType().startsWith("text/event-stream");

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const ping = () => {
          try {
            controller.enqueue(HEARTBEAT);
          } catch {
            clearInterval(beat);
          }
        };
        const beat = sse ? setInterval(ping, deps.heartbeatMs ?? HEARTBEAT_MS) : undefined;
        try {
          for await (const event of handle(input, ctx, deps.store, ac.signal)) {
            controller.enqueue(textEncoder.encode(encoder.encode(event)));
          }
        } finally {
          clearInterval(beat);
          leave();
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        ac.abort();
      },
    });

    return new Response(stream, {
      headers: { "content-type": encoder.getContentType(), "cache-control": "no-cache", connection: "keep-alive" },
    });
  });

  return app;
}
