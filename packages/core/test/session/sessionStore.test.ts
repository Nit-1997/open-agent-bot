import { describe, expect, it, vi } from "vitest";
import { SessionCapacityError, type SessionEntry, type SessionOwner, SessionStore } from "../../src/session/sessionStore.js";
import { DEFAULT_AGENT } from "@oab/shared/profile";
import { WorkspaceStore } from "../../src/workspace/store.js";
import { NO_CAPABILITIES } from "../../src/identity/types.js";
import { ALICE, ALL_CAPABILITIES, BOB } from "../fixtures/users.js";

const t1: SessionOwner = { user: ALICE, chatId: "t1" };
const t2: SessionOwner = { user: ALICE, chatId: "t2" };
const at = (user = ALICE, chatId = "c") => ({ user, chatId });

function entry(): SessionEntry {
  return {
    session: {} as SessionEntry["session"],
    busy: false,
    lastUsed: 0,
    dispose: vi.fn(async () => {}),
    workspace: new WorkspaceStore(),
  };
}

describe("SessionStore", () => {
  it("disposeAll waits for sessions still being created and disposes them too", async () => {
    let finish!: (e: SessionEntry) => void;
    const store = new SessionStore({ idleMs: 1000, create: () => new Promise<SessionEntry>((r) => (finish = r)) });
    const creating = store.getOrCreate(t1, null, DEFAULT_AGENT);
    await new Promise((r) => setTimeout(r, 0));
    const e = entry();
    const done = store.disposeAll();
    finish(e);
    await Promise.all([done, creating]);
    expect(e.dispose).toHaveBeenCalled();
  });

  it("passes the seed to create for a new session and not for an existing one", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const seed = { history: [{ role: "user" as const, text: "hi" }], earlier: { plans: [] } };
    const first = await store.getOrCreate(t1, null, DEFAULT_AGENT, seed);
    const again = await store.getOrCreate(t1, null, DEFAULT_AGENT, { earlier: { plans: [] } });
    expect(again).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(t1, null, DEFAULT_AGENT, seed);
  });

  it("creates one session when the same chat is opened twice at once, even while making room", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create, limits: { perUser: 1 } });
    const old = await store.getOrCreate(at(ALICE, "old"), null, DEFAULT_AGENT);
    const [a, b] = await Promise.all([
      store.getOrCreate(at(ALICE, "new"), null, DEFAULT_AGENT),
      store.getOrCreate(at(ALICE, "new"), null, DEFAULT_AGENT),
    ]);
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(2);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(store.get(at(ALICE, "old"))).toBeUndefined();
  });

  it("never holds more than the per-user limit when different chats open at once", async () => {
    const made: SessionEntry[] = [];
    const store = new SessionStore({
      idleMs: 1000,
      limits: { perUser: 2 },
      create: async () => {
        const e = entry();
        made.push(e);
        return e;
      },
    });
    await store.getOrCreate(at(ALICE, "a"), null, DEFAULT_AGENT);
    await store.getOrCreate(at(ALICE, "b"), null, DEFAULT_AGENT);
    const opened = await Promise.allSettled(["c", "d", "e"].map((c) => store.getOrCreate(at(ALICE, c), null, DEFAULT_AGENT)));
    const live = made.filter((e) => !(e.dispose as ReturnType<typeof vi.fn>).mock.calls.length);
    expect(live.length).toBeLessThanOrEqual(2);
    expect(opened.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("getOrCreate twice returns same entry", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const a = await store.getOrCreate(t1, null, DEFAULT_AGENT);
    const b = await store.getOrCreate(t1, null, DEFAULT_AGENT);
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.get(t1)).toBe(a);
  });

  it("sweep disposes entries idle longer than idleMs", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, now: () => now, create: async () => entry() });
    const e = await store.getOrCreate(t1, null, DEFAULT_AGENT);
    now = 1001;
    await store.sweep();
    expect(e.dispose).toHaveBeenCalled();
    expect(store.get(t1)).toBeUndefined();
  });

  it("sweep keeps busy entries", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, now: () => now, create: async () => entry() });
    const e = await store.getOrCreate(t1, null, DEFAULT_AGENT);
    e.busy = true;
    now = 5000;
    await store.sweep();
    expect(e.dispose).not.toHaveBeenCalled();
    expect(store.get(t1)).toBe(e);
  });

  it("sweep keeps going when one dispose fails", async () => {
    let now = 0;
    const broken = { ...entry(), dispose: vi.fn(async () => Promise.reject(new Error("boom"))) };
    const healthy = entry();
    const queue = [broken, healthy];
    const store = new SessionStore({ idleMs: 1000, now: () => now, create: async () => queue.shift()! });
    await store.getOrCreate(t1, null, DEFAULT_AGENT);
    await store.getOrCreate(t2, null, DEFAULT_AGENT);
    now = 5000;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(store.sweep()).resolves.toBeUndefined();
    quiet.mockRestore();
    expect(healthy.dispose).toHaveBeenCalled();
    expect(store.get(t1)).toBeUndefined();
    expect(store.get(t2)).toBeUndefined();
  });

  it("keys sessions by user and chat, so the same chat id never crosses users", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const a = await store.getOrCreate(at(ALICE, "same"), null, DEFAULT_AGENT);
    const b = await store.getOrCreate(at(BOB, "same"), null, DEFAULT_AGENT);
    expect(a).not.toBe(b);
    expect(store.get(at(BOB, "same"))).toBe(b);
  });

  it("disposes a user's least recently used idle session to make room for a fourth", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 60_000, now: () => ++now, create: async () => entry() });
    const first = await store.getOrCreate(at(ALICE, "1"), null, DEFAULT_AGENT);
    await store.getOrCreate(at(ALICE, "2"), null, DEFAULT_AGENT);
    await store.getOrCreate(at(ALICE, "3"), null, DEFAULT_AGENT);
    await store.getOrCreate(at(ALICE, "4"), null, DEFAULT_AGENT);
    expect(first.dispose).toHaveBeenCalled();
    expect(store.get(at(ALICE, "1"))).toBeUndefined();
  });

  it("refuses a fourth session when the user's three are busy, and caps the total", async () => {
    const store = new SessionStore({ idleMs: 60_000, create: async () => ({ ...entry(), busy: true }), limits: { total: 4 } });
    for (const c of ["1", "2", "3"]) await store.getOrCreate(at(ALICE, c), null, DEFAULT_AGENT);
    await expect(store.getOrCreate(at(ALICE, "4"), null, DEFAULT_AGENT)).rejects.toBeInstanceOf(SessionCapacityError);
    await store.getOrCreate(at(BOB, "1"), null, DEFAULT_AGENT);
    await expect(store.getOrCreate(at(BOB, "2"), null, DEFAULT_AGENT)).rejects.toBeInstanceOf(SessionCapacityError);
  });

  it("disposeUser aborts and removes only that user's sessions", async () => {
    const store = new SessionStore({
      idleMs: 60_000,
      create: async () => ({ ...entry(), session: { abort: vi.fn(async () => {}) } as never }),
    });
    const a = await store.getOrCreate(at(ALICE, "1"), null, DEFAULT_AGENT);
    const b = await store.getOrCreate(at(BOB, "1"), null, DEFAULT_AGENT);
    a.busy = true;
    await store.disposeUser(ALICE.id);
    expect(a.session.abort).toHaveBeenCalled();
    expect(a.dispose).toHaveBeenCalled();
    expect(store.get(at(ALICE, "1"))).toBeUndefined();
    expect(store.get(at(BOB, "1"))).toBe(b);
  });
});

describe("SessionStore.retireUser", () => {
  it("disposes idle sessions now, keeps a busy one running and drops it once the run releases it", async () => {
    const made: SessionEntry[] = [];
    const store = new SessionStore({
      idleMs: 1000,
      create: async () => {
        const e = entry();
        made.push(e);
        return e;
      },
    });
    const idle = await store.getOrCreate(at(ALICE, "idle"), null, DEFAULT_AGENT);
    const busy = await store.getOrCreate(at(ALICE, "busy"), null, DEFAULT_AGENT);
    const other = await store.getOrCreate(at(BOB, "busy"), null, DEFAULT_AGENT);
    busy.busy = true;
    await store.retireUser(ALICE.id);
    expect(idle.dispose).toHaveBeenCalled();
    expect(busy.dispose).not.toHaveBeenCalled();
    expect(store.get(at(ALICE, "busy"))).toBeUndefined();
    expect(await store.getOrCreate(at(ALICE, "busy"), null, DEFAULT_AGENT)).toBe(busy);
    busy.busy = false;
    await store.release(at(ALICE, "busy"), busy);
    expect(busy.dispose).toHaveBeenCalled();
    expect(other.dispose).not.toHaveBeenCalled();
    const fresh = await store.getOrCreate(at(ALICE, "busy"), null, DEFAULT_AGENT);
    expect(fresh).not.toBe(busy);
    expect(made).toHaveLength(4);
  });

  it("replaces a retired session that went idle without a release", async () => {
    const store = new SessionStore({ idleMs: 1000, create: async () => entry() });
    const first = await store.getOrCreate(t1, null, DEFAULT_AGENT);
    first.busy = true;
    await store.retireUser(ALICE.id);
    first.busy = false;
    const next = await store.getOrCreate(t1, null, DEFAULT_AGENT);
    expect(next).not.toBe(first);
    expect(first.dispose).toHaveBeenCalled();
  });
});

describe("SessionStore capability fingerprint", () => {
  const owner = (capabilities = NO_CAPABILITIES) => ({ user: { ...ALICE, capabilities }, chatId: "c" });

  it("drops an idle session built under other capabilities and rebuilds it, logging the change", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const admin = await store.getOrCreate(owner(ALL_CAPABILITIES), null, DEFAULT_AGENT);
    expect(store.get(owner(ALL_CAPABILITIES))).toBe(admin);
    expect(store.get(owner())).toBeUndefined();
    const member = await store.getOrCreate(owner(), null, DEFAULT_AGENT);
    expect(member).not.toBe(admin);
    expect(admin.dispose).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(store.get(owner())).toBe(member);
    expect(info.mock.calls.flat().join(" ")).toContain(`[session] capabilities changed user=${ALICE.id} chat=c, rebuilt`);
    info.mockRestore();
  });

  it("retires a busy session built under other capabilities and rebuilds it on the next run", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const admin = await store.getOrCreate(owner(ALL_CAPABILITIES), null, DEFAULT_AGENT);
    admin.busy = true;
    const during = await store.getOrCreate(owner(), null, DEFAULT_AGENT);
    expect(during).toBe(admin);
    expect(admin.retired).toBe(true);
    expect(admin.dispose).not.toHaveBeenCalled();
    admin.busy = false;
    await store.release(owner(), admin);
    expect(admin.dispose).toHaveBeenCalledTimes(1);
    const next = await store.getOrCreate(owner(), null, DEFAULT_AGENT);
    expect(next).not.toBe(admin);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("reuses the session while the capabilities stay the same", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const first = await store.getOrCreate(owner(ALL_CAPABILITIES), null, DEFAULT_AGENT);
    const again = await store.getOrCreate({ user: { ...ALICE, capabilities: { ...ALL_CAPABILITIES } }, chatId: "c" }, null, DEFAULT_AGENT);
    expect(again).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("ignores capabilities that do not change the hub", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const first = await store.getOrCreate(owner({ ...NO_CAPABILITIES, admin: true }), null, DEFAULT_AGENT);
    expect(await store.getOrCreate(owner(), null, DEFAULT_AGENT)).toBe(first);
  });
});
