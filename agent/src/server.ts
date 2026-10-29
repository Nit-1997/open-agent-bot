import { serve } from "@hono/node-server";
import { createApp, defaultModelRef } from "./app.js";
import { ArtifactStore } from "./artifacts/store.js";
import { loadConfig } from "./config.js";
import { FrameBus } from "./browser/frames.js";
import { ActiveCart } from "./shop/cart.js";
import { workspaceCart, workspaceNote } from "./workspace/cart.js";
import { Evidence } from "./grounding/evidence.js";
import { createPiSession } from "./pi/createPiSession.js";
import { ProviderHub } from "./providers/hub.js";
import { LoginFlows } from "./providers/logins.js";
import { loadSkillCatalog, skillsDir } from "./skills/catalog.js";
import { buildSystemPrompt } from "./prompt/systemPrompt.js";
import { SessionStore } from "./session/sessionStore.js";
import { BrowserPool } from "./tools/browserPool.js";
import { ToolBudget } from "./tools/budget.js";
import { buildTools, PER_REPLY_LIMITS } from "./tools/index.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;

const cfg = loadConfig(process.env);
const artifacts = new ArtifactStore(cfg.artifactsDir);
const workspace = cfg.flags.workspace ? (await import("./workspace/store.js")).WorkspaceStore.at(cfg.dataDir) : undefined;
const pool = new BrowserPool();
const hub = await ProviderHub.create({
  dataDir: cfg.dataDir,
  ...(cfg.llmApiKey && { litellm: { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, models: cfg.models } }),
});

function modelFor(ref: string | undefined) {
  const fallback = defaultModelRef(cfg, hub);
  const model = (ref && hub.resolve(ref)) || (fallback && hub.resolve(fallback));
  if (!model) throw new Error("No model is set up yet. Add a provider in Settings → Models.");
  return model;
}

const store = new SessionStore({
  idleMs: SESSION_IDLE_MS,
  create: async (threadId, userContext, history) => {
    const budget = new ToolBudget(PER_REPLY_LIMITS);
    const evidence = new Evidence();
    const frames = new FrameBus();
    const cart = workspace ? workspaceCart(workspace, threadId) : new ActiveCart();
    const skills = cfg.flags.promptV2 ? loadSkillCatalog(skillsDir(), { workspace: cfg.flags.workspace }) : [];
    const handle = await createPiSession({
      runtime: hub.runtime,
      model: modelFor(userContext?.model),
      systemPrompt: buildSystemPrompt(userContext, { promptV2: cfg.flags.promptV2, skills }),
      tools: buildTools({ cfg, artifacts, pool, threadId, userContext, budget, evidence, frames, cart, skills, workspace }),
      ...(cfg.flags.promptV2 && { skillsDir: skillsDir() }),
      ...(workspace && { history, contextNote: () => workspaceNote(workspace, threadId) }),
    });
    return {
      session: handle.session,
      busy: false,
      lastUsed: Date.now(),
      onRunStart: () => budget.reset(),
      evidence,
      frames,
      cart,
      setModel: async (ref: string) => {
        const model = hub.resolve(ref);
        if (!model) throw new Error(`The model ${ref} isn't available any more. Pick another one from the model menu.`);
        await handle.setModel(model);
        console.log(`[run] thread=${threadId} model=${ref}`);
      },
      dispose: async () => {
        await Promise.all([handle.dispose(), pool.close(threadId)]);
      },
    };
  },
});

setInterval(() => void store.sweep(), 60_000).unref();

const logins = new LoginFlows((id, ui) => hub.login(id, ui));
const app = createApp({ cfg, store, artifacts, hub, logins, run: { workspace } });
serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`agent listening on :${info.port}`);
});

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    void store
      .disposeAll()
      .then(() => Promise.allSettled([pool.closeAll(), artifacts.close(), workspace?.close()]))
      .finally(() => process.exit(0));
  });
}
