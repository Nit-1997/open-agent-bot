import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPiSession } from "./pi/createPiSession.js";
import { buildSystemPrompt } from "./prompt/systemPrompt.js";
import { SessionStore } from "./session/sessionStore.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;

const cfg = loadConfig(process.env);

const store = new SessionStore({
  idleMs: SESSION_IDLE_MS,
  create: async (_threadId, ctx) => {
    const handle = await createPiSession({ cfg, systemPrompt: buildSystemPrompt(ctx), tools: [] });
    return { session: handle.session, busy: false, lastUsed: Date.now(), dispose: handle.dispose };
  },
});

setInterval(() => void store.sweep(), 60_000).unref();

const app = createApp({ cfg, store });
serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`agent listening on :${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void store.disposeAll().finally(() => process.exit(0));
  });
}
