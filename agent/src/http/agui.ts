import type { RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { Hono } from "hono";
import { handleRun, type RunOptions } from "../agui/runHandler.js";
import type { SessionStore } from "../session/sessionStore.js";

function isRunInput(x: unknown): x is RunAgentInput {
  const v = x as Partial<RunAgentInput> | null;
  return !!v && typeof v.threadId === "string" && typeof v.runId === "string" && Array.isArray(v.messages);
}

export function aguiRoutes(deps: { store: SessionStore; authorized: (secret: string | undefined) => boolean; run?: RunOptions }) {
  const app = new Hono();

  app.post("/agui", async (c) => {
    if (!deps.authorized(c.req.header("x-agent-secret"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = await c.req.json().catch(() => null);
    if (!isRunInput(body)) return c.json({ error: "invalid RunAgentInput" }, 400);

    const encoder = new EventEncoder({ accept: c.req.header("accept") });
    const ac = new AbortController();
    c.req.raw.signal?.addEventListener("abort", () => ac.abort(), { once: true });
    const textEncoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of handleRun(body, deps.store, ac.signal, deps.run)) {
            controller.enqueue(textEncoder.encode(encoder.encode(event)));
          }
        } finally {
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
