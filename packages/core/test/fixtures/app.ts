import { type AppDeps, createApp } from "../../src/app.js";
import { ArtifactStore, type Renderer } from "../../src/artifacts/store.js";
import { createGuards } from "../../src/identity/guards.js";
import type { Identity, Principal, RouteMount } from "../../src/identity/types.js";
import { createSafeFetch } from "../../src/lib/safeFetch.js";
import { ConcurrencyGate, RateLimiter, RUN_CONCURRENCY } from "../../src/lib/rateLimit.js";
import { LocalRunPolicy } from "../../src/policy/localRunPolicy.js";
import { RepoProfileStore } from "../../src/profile/store.js";
import type { GatewayLike } from "../../src/providers/hubFactory.js";
import { hubFactory } from "../../src/providers/hubFactory.js";
import { UserHubs } from "../../src/providers/hubs.js";
import { LoginFlows } from "../../src/providers/logins.js";
import { parseCredentialKeys } from "../../src/secrets/keys.js";
import { LocalKeyWrapper } from "../../src/secrets/keyWrapper.js";
import { secretsFor } from "../../src/secrets/secretsFor.js";
import { SessionStore } from "../../src/session/sessionStore.js";
import { TEST_KEY_B64, TEST_SECRET } from "./config.js";
import { fakeFetch } from "./fakeFetch.js";
import { testIdentity, tokenFor } from "./identity.js";
import { MemoryDb } from "./memoryRepos.js";
import { ADMIN, ALICE, BOB } from "./users.js";

export { tokenFor };

export const wrapper = new LocalKeyWrapper(parseCredentialKeys(`v1:${TEST_KEY_B64}`));

export type AppOverrides = Partial<AppDeps> & {
  fetch?: typeof fetch;
  render?: Renderer;
  renderThumb?: Renderer;
  gateway?: GatewayLike;
  identity?: Identity;
  routes?: RouteMount[];
};

export type Harness = Awaited<ReturnType<typeof makeApp>>;

export async function makeApp(over: AppOverrides = {}) {
  const db = new MemoryDb();
  const identity = over.identity ?? testIdentity([ALICE, BOB, ADMIN]);
  const limiter = over.limiter ?? new RateLimiter();
  const repos = (id: string) => db.forUser(id);
  const hubs = new UserHubs(
    hubFactory({
      repos,
      credentials: secretsFor(db, wrapper),
      gateway: over.gateway,
      network: {
        fetch: over.fetch ?? fakeFetch([]),
        userFetch: createSafeFetch(over.fetch ?? fakeFetch([])),
        lookup: async () => ["93.184.216.34"],
      },
    }),
  );
  const store = new SessionStore({
    idleMs: 60_000,
    create: async () => {
      throw new Error("no sessions in this harness");
    },
  });
  const logins = new LoginFlows(async (user, providerId, ui) => {
    await (await hubs.get(user)).login(providerId, ui);
  });
  const profiles = (id: string) => new RepoProfileStore(repos(id).profiles);
  const artifacts = new ArtifactStore(
    over.render ?? (async (html) => Buffer.from(`%PDF ${html.length}`)),
    over.renderThumb ?? (async (html) => Buffer.from(`JPG ${html.length}`)),
  );
  const { fetch: _fetch, render: _render, renderThumb: _thumb, gateway: _gateway, identity: _identity, routes, ...appOver } = over;
  const deps: AppDeps = {
    guards: createGuards(identity),
    limiter,
    runPolicy: new LocalRunPolicy({ limiter, gate: new ConcurrencyGate(RUN_CONCURRENCY) }),
    store,
    runContext: (user) => {
      const r = repos(user.id);
      return {
        user,
        chats: r.chats,
        messages: r.messages,
        profiles: profiles(user.id),
        timeLimitMs: 60_000,
      };
    },
    repos,
    profiles,
    hubs,
    logins,
    artifacts,
    onboarding: {},
    mounts: routes ?? [],
    ...appOver,
  };
  const app = createApp(deps);
  const call = (user: Principal | null, path: string, init: RequestInit & { secret?: string | null } = {}) => {
    const { secret = TEST_SECRET, ...rest } = init;
    return app.request(path, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(secret !== null && { "x-agent-secret": secret }),
        ...(user && { authorization: `Bearer ${tokenFor(user)}` }),
        ...(rest.headers ?? {}),
      },
    });
  };
  return { app, call, db, hubs, logins, limiter, artifacts, deps, identity };
}
