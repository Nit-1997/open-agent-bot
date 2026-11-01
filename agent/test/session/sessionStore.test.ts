import { describe, expect, it, vi } from "vitest";
import { SessionCapacityError, type SessionEntry, type SessionOwner, SessionStore } from "../../src/session/sessionStore.js";
import { ALICE, BOB } from "../fixtures/users.js";

const t1: SessionOwner = { user: ALICE, chatId: "t1" };
const t2: SessionOwner = { user: ALICE, chatId: "t2" };
const at = (user = ALICE, chatId = "c") => ({ user, chatId });

function entry(): SessionEntry {
  return { session: {} as SessionEntry["session"], busy: false, lastUsed: 0, dispose: vi.fn(async () => {}) };
}

describe("SessionStore", () => {
  it("disposeAll waits for sessions still being created and disposes them too", async () => {
    let finish!: (e: SessionEntry) => void;
    const store = new SessionStore({ idleMs: 1000, create: () => new Promise<SessionEntry>((r) => (finish = r)) });
    const creating = store.getOrCreate(t1, null);
    await new Promise((r) => setTimeout(r, 0));
    const e = entry();
    const done = store.disposeAll();
    finish(e);
    await Promise.all([done, creating]);
    expect(e.dispose).toHaveBeenCalled();
  });

  it("creates one session when the same chat is opened twice at once, even while making room", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create, limits: { perUser: 1 } });
    const old = await store.getOrCreate(at(ALICE, "old"), null);
    const [a, b] = await Promise.all([store.getOrCreate(at(ALICE, "new"), null), store.getOrCreate(at(ALICE, "new"), null)]);
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
    await store.getOrCreate(at(ALICE, "a"), null);
    await store.getOrCreate(at(ALICE, "b"), null);
    const opened = await Promise.allSettled(["c", "d", "e"].map((c) => store.getOrCreate(at(ALICE, c), null)));
    const live = made.filter((e) => !(e.dispose as ReturnType<typeof vi.fn>).mock.calls.length);
    expect(live.length).toBeLessThanOrEqual(2);
    expect(opened.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("getOrCreate twice returns same entry", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const a = await store.getOrCreate(t1, null);
    const b = await store.getOrCreate(t1, null);
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.get(t1)).toBe(a);
  });

  it("sweep disposes entries idle longer than idleMs", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, now: () => now, create: async () => entry() });
    const e = await store.getOrCreate(t1, null);
    now = 1001;
    await store.sweep();
    expect(e.dispose).toHaveBeenCalled();
    expect(store.get(t1)).toBeUndefined();
  });

  it("sweep keeps busy entries", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, now: () => now, create: async () => entry() });
    const e = await store.getOrCreate(t1, null);
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
    await store.getOrCreate(t1, null);
    await store.getOrCreate(t2, null);
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
    const a = await store.getOrCreate(at(ALICE, "same"), null);
    const b = await store.getOrCreate(at(BOB, "same"), null);
    expect(a).not.toBe(b);
    expect(store.get(at(BOB, "same"))).toBe(b);
  });

  it("disposes a user's least recently used idle session to make room for a fourth", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 60_000, now: () => ++now, create: async () => entry() });
    const first = await store.getOrCreate(at(ALICE, "1"), null);
    await store.getOrCreate(at(ALICE, "2"), null);
    await store.getOrCreate(at(ALICE, "3"), null);
    await store.getOrCreate(at(ALICE, "4"), null);
    expect(first.dispose).toHaveBeenCalled();
    expect(store.get(at(ALICE, "1"))).toBeUndefined();
  });

  it("refuses a fourth session when the user's three are busy, and caps the total", async () => {
    const store = new SessionStore({ idleMs: 60_000, create: async () => ({ ...entry(), busy: true }), limits: { total: 4 } });
    for (const c of ["1", "2", "3"]) await store.getOrCreate(at(ALICE, c), null);
    await expect(store.getOrCreate(at(ALICE, "4"), null)).rejects.toBeInstanceOf(SessionCapacityError);
    await store.getOrCreate(at(BOB, "1"), null);
    await expect(store.getOrCreate(at(BOB, "2"), null)).rejects.toBeInstanceOf(SessionCapacityError);
  });

  it("disposeUser aborts and removes only that user's sessions", async () => {
    const store = new SessionStore({
      idleMs: 60_000,
      create: async () => ({ ...entry(), session: { abort: vi.fn(async () => {}) } as never }),
    });
    const a = await store.getOrCreate(at(ALICE, "1"), null);
    const b = await store.getOrCreate(at(BOB, "1"), null);
    a.busy = true;
    await store.disposeUser(ALICE.id);
    expect(a.session.abort).toHaveBeenCalled();
    expect(a.dispose).toHaveBeenCalled();
    expect(store.get(at(ALICE, "1"))).toBeUndefined();
    expect(store.get(at(BOB, "1"))).toBe(b);
  });
});
