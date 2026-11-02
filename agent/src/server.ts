import { serve } from "@hono/node-server";
import { createAccessService } from "./access/service.js";
import { createAuthAdmin } from "./admin/authAdmin.js";
import { createAdminService, createLiveAdminCheck } from "./admin/service.js";
import { createApp } from "./app.js";
import { loadOpenReport } from "./artifacts/openReport.js";
import { remoteRenderer } from "./artifacts/remoteRenderer.js";
import { ArtifactStore } from "./artifacts/store.js";
import { ambientProviderEnv } from "./auth/ambientEnv.js";
import { createGuards } from "./auth/middleware.js";
import { UserStatusCache } from "./auth/status.js";
import { createVerifier } from "./auth/verify.js";
import { BrowserPool } from "./browser/pool.js";
import { ConfigError, loadConfig } from "./config.js";
import { LocalKeyWrapper } from "./crypto/keyWrapper.js";
import { createAdminRepo } from "./db/admin.js";
import { createAnonClient, createServiceClient } from "./db/client.js";
import { forUser } from "./db/users.js";
import { createJudgeFrom, type Judge, judgeResolver } from "./judge/index.js";
import { BackgroundQueue } from "./lib/backgroundQueue.js";
import { createLimiter } from "./lib/concurrency.js";
import { log, setLogLevel } from "./lib/log.js";
import { ConcurrencyGate, RateLimiter, RUN_CONCURRENCY } from "./lib/rateLimit.js";
import { nearbyGroceries } from "./onboarding/groceries.js";
import { SupabaseProfileStore } from "./profile/store.js";
import { SupabaseCredentialStore } from "./providers/credentialStore.js";
import { ProviderHub } from "./providers/hub.js";
import { UserHubs } from "./providers/hubs.js";
import { LoginFlows } from "./providers/logins.js";
import { sessionFactory } from "./session/createSession.js";
import { SessionStore } from "./session/sessionStore.js";
import { registry } from "./sources/index.js";
import { SupabaseWorkspaceStore } from "./workspace/store.js";

const SESSION_IDLE_MS = 30 * 60 * 1000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig(process.env);
} catch (err) {
  fail(err instanceof ConfigError ? err.message : `agent configuration failed: ${String(err)}`);
}
setLogLevel(cfg.logLevel);
const ambient = await ambientProviderEnv(process.env);
if (ambient.length) {
  fail(
    `refusing to start: provider credentials in the environment would serve every user (${ambient.join(", ")}). Remove them; users add keys in the app.`,
  );
}

const db = createServiceClient(cfg);
const anon = createAnonClient(cfg);
const adminRepo = createAdminRepo(db);
const wrapper = new LocalKeyWrapper(cfg.credentialKeys);
const repos = (userId: string) => forUser(db, userId);
const profiles = (userId: string) => new SupabaseProfileStore(repos(userId).profiles);
const renderer = remoteRenderer({ url: cfg.rendererUrl, secret: cfg.rendererSecret });
const artifacts = new ArtifactStore(renderer.pdf, renderer.thumb);
const pool = new BrowserPool();
const limiter = new RateLimiter();
const jevLimiter = createLimiter(cfg.jevConcurrency);

const hubs = new UserHubs((user) => {
  const r = repos(user.id);
  return ProviderHub.create({
    userId: user.id,
    isAdmin: user.isAdmin,
    settings: r.providerSettings,
    credentials: new SupabaseCredentialStore(user.id, r.credentials, wrapper),
    ...(cfg.llmApiKey && { litellm: { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, models: cfg.models } }),
  });
});

const judges = new WeakMap<ProviderHub, () => Promise<Judge>>();
const judgeFor = (hub: ProviderHub) => {
  let judge = judges.get(hub);
  if (!judge) {
    judge = judgeResolver(() => createJudgeFrom({ runtime: hub.runtime, models: cfg.jevModels, limiter: jevLimiter }));
    judges.set(hub, judge);
  }
  return judge;
};
log.info(`[jev] candidates=${cfg.jevModels.join(",")}`);

const store = new SessionStore({ idleMs: SESSION_IDLE_MS, create: sessionFactory({ cfg, hubs, repos, artifacts, pool, judgeFor }) });
const logins = new LoginFlows(async (user, providerId, ui) => {
  await (await hubs.get(user)).login(providerId, ui);
  hubs.invalidate(user.id);
});
const status = new UserStatusCache((id) => adminRepo.users.status(id));
const authAdmin = createAuthAdmin({ service: db, anon, appOrigin: cfg.appOrigin });

const admin = createAdminService({
  repo: adminRepo,
  auth: authAdmin,
  hooks: {
    async onDisabled(userId) {
      status.invalidate(userId);
      logins.cancelAll(userId);
      hubs.invalidate(userId);
      await store.disposeUser(userId);
    },
    onEnabled(userId) {
      status.invalidate(userId);
    },
  },
});

const access = createAccessService({
  pepper: cfg.accessRequestPepper,
  limiter,
  queue: new BackgroundQueue({ name: "access", max: 200, concurrency: 2 }),
  submit: (input) => adminRepo.accessRequests.submit(input),
  sendMagicLink: async (email) => {
    const r = await authAdmin.magicLink(email);
    return r.ok ? {} : { code: r.code };
  },
});

const app = createApp({
  guards: createGuards({
    serviceSecret: cfg.serviceSecret,
    verify: createVerifier(cfg),
    status,
    isLiveAdmin: createLiveAdminCheck(authAdmin),
  }),
  limiter,
  gate: new ConcurrencyGate(RUN_CONCURRENCY),
  store,
  runContext: (user, chatId) => {
    const r = repos(user.id);
    return {
      user,
      chats: r.chats,
      messages: r.messages,
      profiles: profiles(user.id),
      workspace: new SupabaseWorkspaceStore(r.workspace, chatId),
      openReport: (id) => loadOpenReport(artifacts, r, chatId, id),
      timeLimitMs: cfg.runTimeLimitSeconds * 1000,
    };
  },
  repos,
  profiles,
  hubs,
  logins,
  artifacts,
  onboarding: { registry, groceries: (at) => nearbyGroceries(at) },
  access,
  admin,
});

setInterval(() => void store.sweep(), 60_000).unref();
setInterval(() => limiter.sweep(), 10 * 60_000).unref();

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  log.info(`agent listening on :${info.port}`);
});

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    server.close();
    void store
      .disposeAll()
      .then(() => pool.closeAll())
      .finally(() => process.exit(0));
  });
}
