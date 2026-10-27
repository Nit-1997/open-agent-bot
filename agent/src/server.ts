import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ArtifactStore } from "./artifacts/store.js";
import { loadConfig } from "./config.js";
import { createPiSession } from "./pi/createPiSession.js";
import { buildSystemPrompt } from "./prompt/systemPrompt.js";
import { SessionStore } from "./session/sessionStore.js";
import { buildTools } from "./tools/index.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;

const cfg = loadConfig(process.env);
const artifacts = new ArtifactStore(cfg.artifactsDir);

const store = new SessionStore({
  idleMs: SESSION_IDLE_MS,
  create: async (_threadId, ctx) => {
    const handle = await createPiSession({ cfg, systemPrompt: buildSystemPrompt(ctx), tools: buildTools({ cfg, artifacts }) });
    return { session: handle.session, busy: false, lastUsed: Date.now(), dispose: handle.dispose };
  },
});

setInterval(() => void store.sweep(), 60_000).unref();

const app = createApp({ cfg, store, artifacts });
serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`agent listening on :${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void Promise.all([store.disposeAll(), artifacts.close()]).finally(() => process.exit(0));
  });
}
