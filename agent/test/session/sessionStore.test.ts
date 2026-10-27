import { describe, expect, it, vi } from "vitest";
import { type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";

function entry(): SessionEntry {
  return { session: {} as SessionEntry["session"], busy: false, lastUsed: 0, dispose: vi.fn(async () => {}) };
}

describe("SessionStore", () => {
  it("getOrCreate twice returns same entry", async () => {
    const create = vi.fn(async () => entry());
    const store = new SessionStore({ idleMs: 1000, create });
    const a = await store.getOrCreate("t1", null);
    const b = await store.getOrCreate("t1", null);
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.get("t1")).toBe(a);
  });

  it("sweep disposes entries idle longer than idleMs", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, now: () => now, create: async () => entry() });
    const e = await store.getOrCreate("t1", null);
    now = 1001;
    await store.sweep();
    expect(e.dispose).toHaveBeenCalled();
    expect(store.get("t1")).toBeUndefined();
  });

  it("sweep keeps busy entries", async () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, now: () => now, create: async () => entry() });
    const e = await store.getOrCreate("t1", null);
    e.busy = true;
    now = 5000;
    await store.sweep();
    expect(e.dispose).not.toHaveBeenCalled();
    expect(store.get("t1")).toBe(e);
  });
});
