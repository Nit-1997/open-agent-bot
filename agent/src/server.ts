import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ArtifactStore } from "./artifacts/store.js";
import { loadConfig } from "./config.js";
import { Evidence } from "./grounding/evidence.js";
import { createPiSession } from "./pi/createPiSession.js";
import { buildSystemPrompt } from "./prompt/systemPrompt.js";
import { SessionStore } from "./session/sessionStore.js";
import { BrowserPool } from "./tools/browserPool.js";
import { ToolBudget } from "./tools/budget.js";
import { buildTools, PER_REPLY_LIMITS } from "./tools/index.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;

const cfg = loadConfig(process.env);
const artifacts = new ArtifactStore(cfg.artifactsDir);
const pool = new BrowserPool();

const store = new SessionStore({
  idleMs: SESSION_IDLE_MS,
  create: async (threadId, userContext) => {
    const budget = new ToolBudget(PER_REPLY_LIMITS);
    const handle = await createPiSession({
      cfg,
      systemPrompt: buildSystemPrompt(userContext),
      tools: buildTools({ cfg, artifacts, pool, threadId, userContext, budget }),
    });
    return {
      session: handle.session,
      busy: false,
      lastUsed: Date.now(),
      onRunStart: () => budget.reset(),
      evidence: new Evidence(),
      dispose: async () => {
        await Promise.all([handle.dispose(), pool.close(threadId)]);
      },
    };
  },
});

setInterval(() => void store.sweep(), 60_000).unref();

const app = createApp({ cfg, store, artifacts });
serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`agent listening on :${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void store
      .disposeAll()
      .then(() => Promise.all([pool.closeAll(), artifacts.close()]))
      .finally(() => process.exit(0));
  });
}
