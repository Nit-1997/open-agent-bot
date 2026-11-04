import { describe, expect, it, vi } from "vitest";
import { NO_CAPABILITIES, type Principal } from "../../src/identity/types.js";
import { HUB_CAPABILITY_KEYS, type ProviderHub } from "../../src/providers/hub.js";
import { UserHubs } from "../../src/providers/hubs.js";
import { ADMIN, ALICE, ALL_CAPABILITIES, BOB } from "../fixtures/users.js";

const hubFor = (user: Principal) => ({ user }) as unknown as ProviderHub;

function setup(opts: { max?: number; idleMs?: number } = {}) {
  let now = 0;
  const build = vi.fn(async (user: Principal) => hubFor(user));
  const hubs = new UserHubs(build, { ...opts, now: () => now });
  return { hubs, build, tick: (ms: number) => (now += ms) };
}

describe("UserHubs", () => {
  it("reuses a built hub and rebuilds after the idle window", async () => {
    const { hubs, build, tick } = setup({ idleMs: 1000 });
    const first = await hubs.get(ALICE);
    tick(999);
    expect(await hubs.get(ALICE)).toBe(first);
    tick(999);
    expect(await hubs.get(ALICE)).toBe(first);
    tick(1000);
    expect(await hubs.get(ALICE)).not.toBe(first);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used hub when full", async () => {
    const { hubs, build } = setup({ max: 2 });
    await hubs.get(ALICE);
    await hubs.get(BOB);
    await hubs.get(ALICE);
    await hubs.get(ADMIN);
    expect(build).toHaveBeenCalledTimes(3);
    await hubs.get(ALICE);
    expect(build).toHaveBeenCalledTimes(3);
    await hubs.get(BOB);
    expect(build).toHaveBeenCalledTimes(4);
  });

  it("shares one pending build between concurrent callers", async () => {
    let release!: (h: ProviderHub) => void;
    const build = vi.fn(() => new Promise<ProviderHub>((r) => (release = r)));
    const hubs = new UserHubs(build);
    const a = hubs.get(ALICE);
    const b = hubs.get(ALICE);
    expect(a).toBe(b);
    release(hubFor(ALICE));
    expect(await a).toBe(await b);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed build so the next call rebuilds", async () => {
    const build = vi
      .fn<(u: Principal) => Promise<ProviderHub>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockImplementation(async (u) => hubFor(u));
    const hubs = new UserHubs(build);
    await expect(hubs.get(ALICE)).rejects.toThrow("db down");
    await expect(hubs.get(ALICE)).resolves.toBeTruthy();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("keeps admin and member hubs apart and invalidates both", async () => {
    const { hubs, build } = setup();
    const promoted = { ...ALICE, capabilities: ALL_CAPABILITIES };
    const member = await hubs.get(ALICE);
    const admin = await hubs.get(promoted);
    expect(admin).not.toBe(member);
    hubs.invalidate(ALICE.id);
    await hubs.get(ALICE);
    await hubs.get(promoted);
    expect(build).toHaveBeenCalledTimes(4);
    await hubs.get(BOB);
    hubs.invalidate(ALICE.id);
    await hubs.get(BOB);
    expect(build).toHaveBeenCalledTimes(5);
  });

  it("keys hubs by every capability the hub reads", async () => {
    expect(HUB_CAPABILITY_KEYS).toEqual(["privateNetworkModels", "operatorGateway"]);
    for (const key of HUB_CAPABILITY_KEYS) {
      const { hubs, build } = setup();
      const plain = { ...ALICE, capabilities: NO_CAPABILITIES };
      const flipped = { ...ALICE, capabilities: Object.freeze({ ...NO_CAPABILITIES, [key]: true }) };
      const before = await hubs.get(plain);
      const after = await hubs.get(flipped);
      expect(after, key).not.toBe(before);
      expect(build, key).toHaveBeenCalledTimes(2);
      expect(await hubs.get(plain), key).toBe(before);
      hubs.invalidate(ALICE.id);
      await hubs.get(flipped);
      expect(build, key).toHaveBeenCalledTimes(3);
    }
  });

  it("shares a hub across capability sets that differ only in fields the hub does not read", async () => {
    const { hubs, build } = setup();
    const member = await hubs.get({ ...ALICE, capabilities: NO_CAPABILITIES });
    const admin = await hubs.get({ ...ALICE, capabilities: Object.freeze({ ...NO_CAPABILITIES, admin: true }) });
    expect(admin).toBe(member);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
