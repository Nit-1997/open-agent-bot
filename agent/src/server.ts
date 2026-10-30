import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ArtifactStore } from "./artifacts/store.js";
import { BrowserPool } from "./browser/pool.js";
import { loadConfig } from "./config.js";
import { createJudge, judgeResolver } from "./judge/index.js";
import { ProviderHub } from "./providers/hub.js";
import { LoginFlows } from "./providers/logins.js";
import { sessionFactory } from "./session/createSession.js";
import { SessionStore } from "./session/sessionStore.js";
import { WorkspaceStore } from "./workspace/store.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;

const cfg = loadConfig(process.env);
const artifacts = new ArtifactStore(cfg.artifactsDir);
const workspace = WorkspaceStore.at(cfg.dataDir);
const pool = new BrowserPool();
const hub = await ProviderHub.create({
  dataDir: cfg.dataDir,
  ...(cfg.llmApiKey && { litellm: { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, models: cfg.models } }),
});

const judge = judgeResolver(() => createJudge({ runtime: hub.runtime, model: cfg.jevModel, concurrency: cfg.jevConcurrency }));
console.log(`[jev] model=${cfg.jevModel}`);
await judge();

const store = new SessionStore({ idleMs: SESSION_IDLE_MS, create: sessionFactory({ cfg, hub, artifacts, pool, workspace, judge }) });
setInterval(() => void store.sweep(), 60_000).unref();

const logins = new LoginFlows((id, ui) => hub.login(id, ui));
const app = createApp({ cfg, store, artifacts, hub, logins, run: { workspace } });
const server = serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`agent listening on :${info.port}`);
});

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    server.close();
    void store
      .disposeAll()
      .then(() => Promise.allSettled([pool.closeAll(), artifacts.close(), workspace.close()]))
      .finally(() => process.exit(0));
  });
}
