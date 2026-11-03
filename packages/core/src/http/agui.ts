import type { RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { Hono } from "hono";
import type { handleRun, RunContext } from "../agui/runHandler.js";
import { isRunInput, startRun } from "../agui/startRun.js";
import type { AuthEnv, Principal } from "../identity/types.js";
import { UserError } from "../lib/errors.js";
import type { RunPolicy } from "../policy/types.js";
import { errorResponse } from "./handlers.js";
import type { SessionStore } from "../session/sessionStore.js";

export const HEARTBEAT_MS = 15_000;
const HEARTBEAT = new TextEncoder().encode(": ping\n\n");

export function aguiRoutes(deps: {
  store: SessionStore;
  context: (user: Principal, chatId: string) => RunContext;
  policy: RunPolicy;
  heartbeatMs?: number;
  handle?: typeof handleRun;
}) {
  const app = new Hono<AuthEnv>();

  app.post("/agui", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isRunInput(body)) return errorResponse(c, new UserError("invalid RunAgentInput", "invalid"));
    const input: RunAgentInput = { ...body, threadId: body.threadId.toLowerCase() };
    const started = await startRun(deps, c.get("user"), input, { signal: c.req.raw.signal });
    if (!started.ok) return errorResponse(c, started.error);
    const { run } = started;

    try {
      const encoder = new EventEncoder({ accept: c.req.header("accept") });
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
            for (let next = await run.events.next(); !next.done; next = await run.events.next()) {
              controller.enqueue(textEncoder.encode(encoder.encode(next.value)));
            }
          } finally {
            clearInterval(beat);
            run.close();
            try {
              controller.close();
            } catch {}
          }
        },
        cancel() {
          run.close();
        },
      });

      return new Response(stream, {
        headers: { "content-type": encoder.getContentType(), "cache-control": "no-cache", connection: "keep-alive" },
      });
    } catch (err) {
      run.close();
      throw err;
    }
  });

  return app;
}
