import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { loadOpenReport } from "./artifacts/openReport.js";
import { remoteRenderer } from "./artifacts/remoteRenderer.js";
import { ArtifactStore } from "./artifacts/store.js";
import { BrowserPool } from "./browser/pool.js";
import type { CoreConfig } from "./config.js";
import { createGuards } from "./identity/guards.js";
import type { AuthEnv, Identity, RouteMount } from "./identity/types.js";
import { pathCovered } from "./identity/userPaths.js";
import { createJudgeFrom, type Judge, judgeResolver } from "./judge/index.js";
import { createLimiter } from "./lib/concurrency.js";
import { log, setLogLevel } from "./lib/log.js";
import { ConcurrencyGate, RateLimiter, RUN_CONCURRENCY } from "./lib/rateLimit.js";
import { LocalRunPolicy } from "./policy/localRunPolicy.js";
import type { RunPolicy } from "./policy/types.js";
import { nearbyGroceries } from "./onboarding/groceries.js";
import { RepoProfileStore } from "./profile/store.js";
import type { ProviderHub } from "./providers/hub.js";
import { type GatewayLike, hubFactory } from "./providers/hubFactory.js";
import { UserHubs } from "./providers/hubs.js";
import { LoginFlows } from "./providers/logins.js";
import type { KeyWrapper } from "./secrets/keyWrapper.js";
import { secretsFor } from "./secrets/secretsFor.js";
import { sessionFactory } from "./session/createSession.js";
import { SessionStore } from "./session/sessionStore.js";
import { registry } from "./sources/index.js";
import type { Store } from "./store/types.js";

export type CoreHandles = Readonly<{
  limiter: RateLimiter;
  forgetUser(userId: string): Promise<void>;
}>;

export type AgentDeps = Readonly<{
  config: CoreConfig;
  store: Store;
  identity: Identity;
  keyWrapper: KeyWrapper;
  runPolicy?: (h: { limiter: RateLimiter }) => RunPolicy;
  gateway?: GatewayLike;
  routes?: (core: CoreHandles) => RouteMount[];
  host?: string;
  port?: number;
}>;

export type RunningAgent = Readonly<{ app: Hono<AuthEnv>; port: number; host: string; handles: CoreHandles; close(): Promise<void> }>;

const SESSION_IDLE_MS = 30 * 60 * 1000;
const PROTECTED_BASE = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

export function checkMounts(mounts: readonly RouteMount[]): void {
  for (const mount of mounts) {
    const routes = mount.routes.routes;
    if (mount.stage === "public") {
      const hit = routes.find((r) => pathCovered(r.path));
      if (hit) throw new Error(`public mount route ${hit.method} ${hit.path} overlaps a user path`);
      continue;
    }
    const base = mount.basePath;
    if (!PROTECTED_BASE.test(base)) throw new Error(`protected mount basePath "${base}" must be a non-root absolute path`);
    const outside = routes.find((r) => r.path !== base && !r.path.startsWith(`${base}/`));
    if (outside) throw new Error(`protected mount route ${outside.method} ${outside.path} lies outside basePath ${base}`);
  }
}

export const forgetter =
  (parts: { logins: LoginFlows; hubs: UserHubs; sessions: SessionStore }) =>
  async (userId: string): Promise<void> => {
    parts.logins.cancelAll(userId);
    parts.hubs.invalidate(userId);
    await parts.sessions.disposeUser(userId);
  };

export async function startAgent(deps: AgentDeps): Promise<RunningAgent> {
  const cfg = deps.config;
  setLogLevel(cfg.logLevel);
  const repos = (userId: string) => deps.store.forUser(userId);
  const profiles = (userId: string) => new RepoProfileStore(repos(userId).profiles);
  const renderer = remoteRenderer({ url: cfg.rendererUrl, secret: cfg.rendererSecret });
  const artifacts = new ArtifactStore(renderer.pdf, renderer.thumb);
  const pool = new BrowserPool();
  const limiter = new RateLimiter();
  const jevLimiter = createLimiter(cfg.jevConcurrency);

  const hubs = new UserHubs(hubFactory({ repos, credentials: secretsFor(deps.store, deps.keyWrapper), gateway: deps.gateway }));

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

  const sessions = new SessionStore({ idleMs: SESSION_IDLE_MS, create: sessionFactory({ cfg, hubs, repos, artifacts, pool, judgeFor }) });
  const logins = new LoginFlows(async (user, providerId, ui) => {
    await (await hubs.get(user)).login(providerId, ui);
    hubs.invalidate(user.id);
  });
  const handles: CoreHandles = Object.freeze({ limiter, forgetUser: forgetter({ logins, hubs, sessions }) });

  const mounts = deps.routes?.(handles) ?? [];
  checkMounts(mounts);

  const app = createApp({
    guards: createGuards(deps.identity),
    limiter,
    runPolicy: deps.runPolicy?.({ limiter }) ?? new LocalRunPolicy({ limiter, gate: new ConcurrencyGate(RUN_CONCURRENCY) }),
    store: sessions,
    runContext: (user, chatId) => {
      const r = repos(user.id);
      return {
        user,
        chats: r.chats,
        messages: r.messages,
        profiles: profiles(user.id),
        openReport: (id, cached) => loadOpenReport(artifacts, r, chatId, id, cached),
        timeLimitMs: cfg.runTimeLimitSeconds * 1000,
      };
    },
    repos,
    profiles,
    hubs,
    logins,
    artifacts,
    onboarding: { registry, groceries: (at) => nearbyGroceries(at) },
    mounts,
  });

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: deps.port ?? cfg.port, hostname: deps.host ?? "127.0.0.1" }, () => resolve(s));
    s.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  log.info(`agent listening on ${address.address}:${address.port}`);

  const sweeps = [setInterval(() => void sessions.sweep(), 60_000).unref(), setInterval(() => limiter.sweep(), 10 * 60_000).unref()];

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      for (const t of sweeps) clearInterval(t);
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      await sessions.disposeAll();
      await pool.closeAll();
      await deps.store.close?.();
      if ("closeAllConnections" in server) server.closeAllConnections();
      await closed;
    })());

  return Object.freeze({ app, port: address.port, host: address.address, handles, close });
}
