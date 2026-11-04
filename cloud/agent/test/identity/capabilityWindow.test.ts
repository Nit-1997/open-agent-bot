import { EventType } from "@ag-ui/core";
import { NO_CAPABILITIES } from "@oab/core/identity/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthAccount } from "../../src/admin/authAdmin.js";
import { adminHooks } from "../../src/deps.js";
import { createDemotionHook } from "../../src/identity/demotion.js";
import { LiveRoleCache } from "../../src/identity/liveRole.js";
import { UserStatusCache } from "../../src/identity/status.js";
import { createSupabaseIdentity } from "../../src/identity/supabaseIdentity.js";
import { AuthError, type VerifiedUser } from "../../src/identity/verify.js";
import { holdUntilAbort, pullUntil, say } from "../../../../packages/core/test/agui/runWorld.js";
import { capabilityWorld } from "../fixtures/capabilityWorld.js";
import { TEST_SECRET } from "../fixtures/config.js";
import { ALL_CAPABILITIES } from "../fixtures/users.js";

const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const CHAT = "c0000000-0000-4000-8000-000000000001";
const TTL = 2_000;

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const level of ["log", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const clock = { now: 1_000_000 };
  const tokens = new Map<string, VerifiedUser>([
    ["t.admin", { id: ADMIN_ID, email: "admin@example.test", sessionId: "s1", isAdmin: true }],
    ["t.refreshed", { id: ADMIN_ID, email: "admin@example.test", sessionId: "s1", isAdmin: false }],
  ]);
  const account: AuthAccount = {
    id: ADMIN_ID,
    email: "admin@example.test",
    isAdmin: true,
    bannedUntil: null,
    lastSignInAt: null,
    providers: ["email"],
  };
  const auth = {
    down: false,
    getUser: vi.fn(async () => {
      if (auth.down) throw new Error("auth admin down");
      return { ...account };
    }),
  };
  const liveRole = new LiveRoleCache(auth, { now: () => clock.now, ttlMs: TTL });
  const status = new UserStatusCache(async () => "active");
  const demotion = createDemotionHook();
  const onDemoted = vi.fn((id: string) => demotion.notify(id));
  const identity = createSupabaseIdentity({
    serviceSecret: TEST_SECRET,
    verify: async (token) => {
      const u = tokens.get(token);
      if (!u) throw new AuthError("invalid_token");
      return u;
    },
    status,
    liveAdmin: (id) => liveRole.isAdmin(id),
    onDemoted,
  });
  const world = capabilityWorld(identity);
  demotion.bind(adminHooks(status, { forgetUser: world.forgetUser }).onDisabled);
  return { clock, account, auth, world, onDemoted, identity };
}

async function privilegedChat(h: ReturnType<typeof setup>) {
  await h.world.allowPrivateModel(ADMIN_ID);
  const admin = await h.world.authenticate("t.admin");
  expect(admin.capabilities).toEqual(ALL_CAPABILITIES);
  expect(await h.world.outcome(await h.world.start(admin, CHAT, "r1"))).toMatchObject({ model: "used" });
  expect(h.world.sessions).toHaveLength(1);
}

describe("closing the capability window (D18)", () => {
  it("demoted by the live check: within the TTL nothing changes, then the in-flight run is aborted and the same chat refuses the private-network model", async () => {
    const h = setup();
    await privilegedChat(h);
    h.world.useScript(holdUntilAbort);
    const other = "c0000000-0000-4000-8000-000000000002";
    const held = await h.world.start(await h.world.authenticate("t.admin"), other, "r2");
    await pullUntil(held, EventType.TEXT_MESSAGE_CONTENT);
    h.account.isAdmin = false;
    h.clock.now += TTL - 1;
    expect((await h.world.authenticate("t.admin")).capabilities).toEqual(ALL_CAPABILITIES);
    expect(h.onDemoted).not.toHaveBeenCalled();
    h.clock.now += 1;
    const member = await h.world.authenticate("t.admin");
    expect(member.capabilities).toEqual(NO_CAPABILITIES);
    expect(h.onDemoted.mock.calls).toEqual([[ADMIN_ID]]);
    expect(h.world.sessions[1]!.session.abortCalls).toBe(1);
    const aborted = await h.world.outcome(held);
    expect(aborted.events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    h.world.useScript(say);
    expect(await h.world.outcome(await h.world.start(member, CHAT, "r3"))).toMatchObject({ model: "refused" });
    expect(h.world.sessions).toHaveLength(3);
    expect(logs.join("\n")).toContain(`[auth] admin role ended user=${ADMIN_ID}, dropping their sessions`);
  });

  it("demoted by a refreshed token: onDemoted exactly once and the same chat refuses the private-network model", async () => {
    const h = setup();
    await privilegedChat(h);
    const lookups = h.auth.getUser.mock.calls.length;
    const refreshed = await h.world.authenticate("t.refreshed");
    expect(refreshed.capabilities).toEqual(NO_CAPABILITIES);
    await h.world.authenticate("t.refreshed");
    expect(h.onDemoted).toHaveBeenCalledTimes(1);
    expect(h.auth.getUser).toHaveBeenCalledTimes(lookups);
    expect(await h.world.outcome(await h.world.start(refreshed, CHAT, "r2"))).toMatchObject({ model: "refused" });
  });

  it("a failing live lookup serves the request without privileges and rebuilds the existing privileged session, with no demotion", async () => {
    const h = setup();
    await privilegedChat(h);
    h.auth.down = true;
    h.clock.now += TTL;
    const blip = await h.world.authenticate("t.admin");
    expect(blip.capabilities).toEqual(NO_CAPABILITIES);
    expect(h.identity.roleUnverified(blip)).toBe(true);
    expect(await h.world.outcome(await h.world.start(blip, CHAT, "r2"))).toMatchObject({ model: "refused" });
    expect(logs.join("\n")).toContain(`[session] capabilities changed user=${ADMIN_ID} chat=${CHAT}, rebuilt`);
    expect(h.onDemoted).not.toHaveBeenCalled();
    h.auth.down = false;
    const back = await h.world.authenticate("t.admin");
    expect(back.capabilities).toEqual(ALL_CAPABILITIES);
    expect(await h.world.outcome(await h.world.start(back, CHAT, "r3"))).toMatchObject({ model: "used" });
  });
});
