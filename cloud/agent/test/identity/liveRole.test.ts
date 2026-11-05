import { describe, expect, it, vi } from "vitest";
import type { AuthAccount } from "../../src/admin/authAdmin.js";
import { LIVE_ROLE_TTL_MS, LiveRoleCache } from "../../src/identity/liveRole.js";
import { ADMIN, ALICE } from "../fixtures/users.js";

const account = (over: Partial<AuthAccount> = {}): AuthAccount => ({
  id: ADMIN.id,
  email: ADMIN.email,
  isAdmin: true,
  bannedUntil: null,
  lastSignInAt: null,
  providers: ["google"],
  ...over,
});

describe("LiveRoleCache", () => {
  it("caches the answer per user for 30 s, then asks again", async () => {
    let now = 1_000_000;
    const getUser = vi.fn(async () => account());
    const cache = new LiveRoleCache({ getUser }, { now: () => now });
    expect(LIVE_ROLE_TTL_MS).toBe(30_000);
    expect(await cache.isAdmin(ADMIN.id)).toBe(true);
    now += 29_999;
    expect(await cache.isAdmin(ADMIN.id)).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(1);
    now += 1;
    getUser.mockResolvedValueOnce(account({ isAdmin: false }));
    expect(await cache.isAdmin(ADMIN.id)).toBe(false);
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(await cache.isAdmin(ALICE.id)).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(3);
    expect(getUser.mock.calls.map((c) => (c as unknown[])[0])).toEqual([ADMIN.id, ADMIN.id, ALICE.id]);
  });

  it("takes the TTL from its options", async () => {
    let now = 0;
    const getUser = vi.fn(async () => account());
    const cache = new LiveRoleCache({ getUser }, { now: () => now, ttlMs: 2_000 });
    await cache.isAdmin(ADMIN.id);
    now = 1_999;
    await cache.isAdmin(ADMIN.id);
    expect(getUser).toHaveBeenCalledTimes(1);
    now = 2_000;
    await cache.isAdmin(ADMIN.id);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("denies a banned admin until the ban runs out, and missing or member accounts", async () => {
    let now = Date.parse("2026-11-01T00:00:00Z");
    const getUser = vi.fn(async () => account({ bannedUntil: "2026-11-01T01:00:00Z" }));
    const cache = new LiveRoleCache({ getUser }, { now: () => now });
    expect(await cache.isAdmin(ADMIN.id)).toBe(false);
    now = Date.parse("2026-11-01T01:00:00Z");
    expect(await cache.isAdmin(ADMIN.id)).toBe(true);
    expect(await new LiveRoleCache({ getUser: async () => undefined }).isAdmin(ADMIN.id)).toBe(false);
    expect(await new LiveRoleCache({ getUser: async () => account({ isAdmin: false }) }).isAdmin(ADMIN.id)).toBe(false);
  });

  it("throws a lookup error without caching it, so the next call asks again", async () => {
    const getUser = vi.fn(async (): Promise<AuthAccount | undefined> => Promise.reject(new Error("auth admin down")));
    const cache = new LiveRoleCache({ getUser });
    await expect(cache.isAdmin(ADMIN.id)).rejects.toThrow("auth admin down");
    getUser.mockResolvedValueOnce(account());
    expect(await cache.isAdmin(ADMIN.id)).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("shares one lookup between concurrent calls for the same user", async () => {
    let release!: (a: AuthAccount) => void;
    const getUser = vi.fn(() => new Promise<AuthAccount>((r) => (release = r)));
    const cache = new LiveRoleCache({ getUser });
    const both = Promise.all([cache.isAdmin(ADMIN.id), cache.isAdmin(ADMIN.id)]);
    release(account());
    expect(await both).toEqual([true, true]);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("keeps at most 10,000 users, dropping the oldest answer first", async () => {
    const getUser = vi.fn(async (id: string) => account({ id }));
    const cache = new LiveRoleCache({ getUser });
    for (let i = 0; i <= 10_000; i++) await cache.isAdmin(`user-${i}`);
    expect(getUser).toHaveBeenCalledTimes(10_001);
    await cache.isAdmin("user-10000");
    await cache.isAdmin("user-1");
    expect(getUser).toHaveBeenCalledTimes(10_001);
    await cache.isAdmin("user-0");
    expect(getUser).toHaveBeenCalledTimes(10_002);
  });
});
