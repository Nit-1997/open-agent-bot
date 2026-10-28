import type { RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { Hono } from "hono";
import { handleRun } from "./agui/runHandler.js";
import { type ArtifactStore, slugify } from "./artifacts/store.js";
import type { AgentConfig } from "./config.js";
import type { SessionStore } from "./session/sessionStore.js";

function isRunInput(x: unknown): x is RunAgentInput {
  const v = x as Partial<RunAgentInput> | null;
  return !!v && typeof v.threadId === "string" && typeof v.runId === "string" && Array.isArray(v.messages);
}

export function createApp(deps: { cfg: AgentConfig; store: SessionStore; artifacts?: ArtifactStore }) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/artifacts/:file", async (c) => {
    if (!deps.artifacts) return c.notFound();
    const file = c.req.param("file");
    const isPdf = file.endsWith(".pdf");
    const id = isPdf ? file.slice(0, -4) : file;
    if (isPdf) {
      const meta = await deps.artifacts.get(id);
      const pdf = meta && (await deps.artifacts.renderPdf(id));
      if (!meta || !pdf) return c.notFound();
      return new Response(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${slugify(meta.title)}.pdf"`,
        },
      });
    }
    const a = await deps.artifacts.get(id);
    if (!a) return c.notFound();
    return new Response(a.html, {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-scripts" },
    });
  });

  const authorized = (secret: string | undefined) => !deps.cfg.sharedSecret || secret === deps.cfg.sharedSecret;

  app.get("/models", (c) => {
    if (!authorized(c.req.header("x-agent-secret"))) return c.json({ error: "unauthorized" }, 401);
    return c.json({ default: deps.cfg.model, models: deps.cfg.models });
  });

  app.post("/agui", async (c) => {
    if (!authorized(c.req.header("x-agent-secret"))) {
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
          for await (const event of handleRun(body, deps.store, ac.signal)) {
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
