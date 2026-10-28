import type { RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { type Context, type Handler, Hono, type MiddlewareHandler } from "hono";
import { handleRun } from "./agui/runHandler.js";
import { type ArtifactStore, slugify } from "./artifacts/store.js";
import type { AgentConfig } from "./config.js";
import type { ProviderHub } from "./providers/hub.js";
import type { SessionStore } from "./session/sessionStore.js";

function isRunInput(x: unknown): x is RunAgentInput {
  const v = x as Partial<RunAgentInput> | null;
  return !!v && typeof v.threadId === "string" && typeof v.runId === "string" && Array.isArray(v.messages);
}

export function defaultModelRef(cfg: AgentConfig, hub: ProviderHub): string | null {
  const preferred = cfg.model.includes("/") ? cfg.model : `litellm/${cfg.model}`;
  if (hub.resolve(preferred)) return preferred;
  return hub.enabledModels()[0]?.id ?? null;
}

export function createApp(deps: { cfg: AgentConfig; store: SessionStore; artifacts?: ArtifactStore; hub?: ProviderHub }) {
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

  const guard: MiddlewareHandler = async (c, next) => {
    if (!authorized(c.req.header("x-agent-secret"))) return c.json({ error: "unauthorized" }, 401);
    if (!deps.hub) return c.json({ error: "providers are not available" }, 503);
    await next();
  };
  for (const path of ["/models", "/providers", "/providers/*"]) app.use(path, guard);
  const safe =
    (handler: (c: Context) => Promise<Response> | Response): Handler =>
    async (c) => {
      try {
        return await handler(c);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    };
  const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const hub = () => deps.hub!;

  app.get("/models", safe((c) => c.json({ default: defaultModelRef(deps.cfg, hub()), models: hub().enabledModels() })));
  app.get("/providers", safe((c) => c.json({ providers: hub().list() })));
  app.post(
    "/providers/local",
    safe(async (c) => {
      const b = await body(c);
      const provider = await hub().addLocal({
        kind: String(b.kind ?? ""),
        baseUrl: String(b.baseUrl ?? ""),
        ...(typeof b.apiKey === "string" && { apiKey: b.apiKey }),
        ...(typeof b.label === "string" && { label: b.label }),
      });
      return c.json({ provider });
    }),
  );
  app.post(
    "/providers/test",
    safe(async (c) => c.json(await hub().test(String((await body(c)).model ?? "")))),
  );
  app.post(
    "/providers/:id/key",
    safe(async (c) => {
      const b = await body(c);
      await hub().setKey((c.req.param("id") ?? ""), typeof b.apiKey === "string" ? b.apiKey : "");
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/providers/:id",
    safe(async (c) => {
      await hub().remove((c.req.param("id") ?? ""));
      return c.json({ ok: true });
    }),
  );
  app.get("/providers/:id/models", safe((c) => c.json({ models: hub().models((c.req.param("id") ?? "")) })));
  app.put(
    "/providers/:id/models",
    safe(async (c) => {
      const b = await body(c);
      await hub().setEnabled((c.req.param("id") ?? ""), Array.isArray(b.enabled) ? b.enabled.map(String) : []);
      return c.json({ ok: true });
    }),
  );

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
