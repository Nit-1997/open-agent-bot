import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { NO_CAPABILITIES } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthAdmin } from "../../src/admin/authAdmin.js";
import { loadHostedConfig } from "../../src/config.js";
import { hostedAgentDeps } from "../../src/deps.js";
import { LiveRoleCache } from "../../src/identity/liveRole.js";
import { createAnonClient, createServiceClient } from "../../src/store/client.js";
import { holdUntilAbort, pullUntil, say } from "../../../../packages/core/test/agui/runWorld.js";
import { capabilityWorld } from "../fixtures/capabilityWorld.js";
import { TEST_ENV } from "../fixtures/config.js";
import { ALL_CAPABILITIES } from "../fixtures/users.js";
import { anon, cleanup, closeHarness, createUser, type LocalUser, localEnv, signIn, sql } from "./harness.js";

const TTL = 2_000;

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const level of ["log", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

function agent() {
  const env = localEnv();
  const cfg = loadHostedConfig({
    ...TEST_ENV,
    SUPABASE_LOCAL_STACK: "1",
    SUPABASE_URL: env.apiUrl,
    SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
    SUPABASE_SECRET_KEY: env.secretKey,
    APP_ORIGIN: "http://localhost:18721",
  });
  const clients = { db: createServiceClient(cfg), anon: createAnonClient(cfg) };
  const real = createAuthAdmin({ service: clients.db, anon: clients.anon, appOrigin: cfg.appOrigin });
  const lookup = { down: false, calls: 0 };
  const liveRole = new LiveRoleCache(
    {
      getUser: async (id) => {
        lookup.calls++;
        if (lookup.down) throw new Error("fake getUser error");
        return real.getUser(id);
      },
    },
    { ttlMs: TTL },
  );
  const { deps } = hostedAgentDeps(cfg, clients, { liveRole });
  const world = capabilityWorld(deps.identity);
  deps.routes!({ limiter: new RateLimiter(), forgetUser: world.forgetUser });
  return { world, lookup };
}

const setRole = (id: string, admin: boolean) =>
  sql(
    admin
      ? `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb where id = $1`
      : `update auth.users set raw_app_meta_data = raw_app_meta_data - 'role' where id = $1`,
    [id],
  );

async function admin(): Promise<LocalUser> {
  const user = await createUser();
  await setRole(user.id, true);
  return user;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logged = (text: string) => logs.some((l) => l.includes(text));

describe("capability window on the local stack (AC 20, AC 21)", () => {
  it("AC 20: a SQL demotion with the token unchanged aborts the in-flight run and refuses the private-network model in the same chat within the TTL", async () => {
    const { world } = agent();
    const user = await admin();
    const { accessToken } = await signIn(user);
    const chat = randomUUID();
    await world.allowPrivateModel(user.id);
    const before = await world.authenticate(accessToken);
    expect(before.capabilities).toEqual(ALL_CAPABILITIES);
    expect(await world.outcome(await world.start(before, chat, "r1"))).toMatchObject({ model: "used" });
    world.useScript(holdUntilAbort);
    const held = await world.start(before, chat, "r2");
    await pullUntil(held, EventType.TEXT_MESSAGE_CONTENT);
    await setRole(user.id, false);
    const demotedAt = Date.now();
    expect((await world.authenticate(accessToken)).capabilities).toEqual(ALL_CAPABILITIES);
    await sleep(TTL + 100);
    const after = await world.authenticate(accessToken);
    const detected = Date.now() - demotedAt;
    expect(after.capabilities).toEqual(NO_CAPABILITIES);
    expect(detected).toBeLessThan(30_000);
    expect(logged(`[auth] admin role ended user=${user.id}, dropping their sessions`)).toBe(true);
    expect(world.sessions[0]!.session.abortCalls).toBe(1);
    await world.outcome(held);
    world.useScript(say);
    const refused = await world.outcome(await world.start(after, chat, "r3"));
    expect(refused).toMatchObject({ model: "refused" });
    expect(world.sessions).toHaveLength(2);
  });

  it("AC 21: a demoted user who refreshes the token and sends in an existing privileged chat gets the private-network model refused", async () => {
    const { world, lookup } = agent();
    const user = await admin();
    const session = await signIn(user);
    const chat = randomUUID();
    await world.allowPrivateModel(user.id);
    const before = await world.authenticate(session.accessToken);
    expect(await world.outcome(await world.start(before, chat, "r1"))).toMatchObject({ model: "used" });
    await setRole(user.id, false);
    const { data, error } = await anon().auth.refreshSession({ refresh_token: session.refreshToken });
    if (error || !data.session) throw error ?? new Error("refreshSession returned no session");
    const calls = lookup.calls;
    const refreshed = await world.authenticate(data.session.access_token);
    expect(refreshed.capabilities).toEqual(NO_CAPABILITIES);
    expect(lookup.calls).toBe(calls);
    expect(logs.filter((l) => l.includes(`[auth] admin role ended user=${user.id}`))).toHaveLength(1);
    expect(await world.outcome(await world.start(refreshed, chat, "r2"))).toMatchObject({ model: "refused" });
    await world.authenticate(data.session.access_token);
    expect(logs.filter((l) => l.includes(`[auth] admin role ended user=${user.id}`))).toHaveLength(1);
  });

  it("AC 21: with the live lookup failing, an existing privileged session is rebuilt without privileges and nobody is demoted", async () => {
    const { world, lookup } = agent();
    const user = await admin();
    const { accessToken } = await signIn(user);
    const chat = randomUUID();
    await world.allowPrivateModel(user.id);
    const before = await world.authenticate(accessToken);
    expect(await world.outcome(await world.start(before, chat, "r1"))).toMatchObject({ model: "used" });
    lookup.down = true;
    await sleep(TTL + 100);
    const blip = await world.authenticate(accessToken);
    expect(blip.capabilities).toEqual(NO_CAPABILITIES);
    expect(logged(`[auth] live admin check failed user=${user.id}`)).toBe(true);
    expect(await world.outcome(await world.start(blip, chat, "r2"))).toMatchObject({ model: "refused" });
    expect(logged(`[session] capabilities changed user=${user.id} chat=${chat}, rebuilt`)).toBe(true);
    expect(logged("[auth] admin role ended")).toBe(false);
    lookup.down = false;
    const back = await world.authenticate(accessToken);
    expect(back.capabilities).toEqual(ALL_CAPABILITIES);
    expect(await world.outcome(await world.start(back, chat, "r3"))).toMatchObject({ model: "used" });
  });
});
