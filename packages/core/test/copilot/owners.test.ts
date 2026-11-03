import type { RunAgentInput } from "@ag-ui/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunContext } from "../../src/agui/runHandler.js";
import { startRun } from "../../src/agui/startRun.js";
import { OWNER_TTL_MS, OWNERS_MAX, ThreadOwners } from "../../src/copilot/owners.js";
import { UserError } from "../../src/lib/errors.js";
import { ConcurrencyGate, RateLimiter } from "../../src/lib/rateLimit.js";
import { LocalRunPolicy } from "../../src/policy/localRunPolicy.js";
import { SessionStore } from "../../src/session/sessionStore.js";
import { ALICE, BOB } from "../fixtures/users.js";
import { fakeRun, runBody, T1, T2 } from "./harness.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

afterEach(() => {
  vi.useRealTimers();
});

describe("ThreadOwners", () => {
  it("records the claimer and allows only that user, with one lowercase key", () => {
    const owners = new ThreadOwners();
    owners.claim(T1.toUpperCase(), ALICE.id);
    expect(owners.ownerOf(T1)).toBe(ALICE.id);
    expect(owners.ownerOf(T1.toUpperCase())).toBe(ALICE.id);
    expect(owners.ownerOf(T2)).toBeUndefined();
    expect(owners.size).toBe(1);
  });

  it("writes nothing when the run's claim is refused", async () => {
    const owners = new ThreadOwners();
    const refuse = { claim: async () => Promise.reject(new UserError("This chat doesn't exist.", "not_found")), touch: async () => {} };
    const store = new SessionStore({ idleMs: 1000, create: async () => Promise.reject(new Error("unused")) });
    const deps = {
      store,
      policy: new LocalRunPolicy({ limiter: new RateLimiter(), gate: new ConcurrencyGate(2) }),
      context: (user: typeof BOB) => ({ user, chats: refuse, messages: {} as RunContext["messages"], timeLimitMs: 1000 }),
      handle: fakeRun(),
    };
    const started = await startRun(deps, BOB, runBody(T1) as RunAgentInput, { onClaimed: (t) => owners.claim(t, BOB.id) });
    if (!started.ok) throw started.error;
    const types: string[] = [];
    for (let next = await started.run.events.next(); !next.done; next = await started.run.events.next()) types.push(next.value.type);
    started.run.close();
    expect(types).toEqual(["RUN_STARTED", "RUN_ERROR"]);
    expect(owners.size).toBe(0);
    expect(owners.ownerOf(T1)).toBeUndefined();
  });

  it("evicts the least recently used entry at the cap", () => {
    const owners = new ThreadOwners({ max: 3 });
    owners.claim(uuid(1), ALICE.id);
    owners.claim(uuid(2), ALICE.id);
    owners.claim(uuid(3), ALICE.id);
    expect(owners.ownerOf(uuid(1))).toBe(ALICE.id);
    owners.claim(uuid(4), BOB.id);
    expect(owners.size).toBe(3);
    expect(owners.ownerOf(uuid(2))).toBeUndefined();
    expect(owners.ownerOf(uuid(1))).toBe(ALICE.id);
    expect(owners.ownerOf(uuid(4))).toBe(BOB.id);
  });

  it("forgets an owner 30 minutes after its last use", () => {
    vi.useFakeTimers();
    const owners = new ThreadOwners();
    owners.claim(T1, ALICE.id);
    owners.claim(T2, ALICE.id);
    vi.advanceTimersByTime(OWNER_TTL_MS - 1000);
    expect(owners.ownerOf(T1)).toBe(ALICE.id);
    vi.advanceTimersByTime(OWNER_TTL_MS - 1000);
    expect(owners.ownerOf(T1)).toBe(ALICE.id);
    expect(owners.ownerOf(T2)).toBeUndefined();
    vi.advanceTimersByTime(OWNER_TTL_MS);
    expect(owners.ownerOf(T1)).toBeUndefined();
  });

  it("stays bounded after 100k claims", () => {
    const owners = new ThreadOwners();
    for (let i = 0; i < 100_000; i++) owners.claim(uuid(i), i % 2 ? ALICE.id : BOB.id);
    expect(owners.size).toBe(OWNERS_MAX);
    expect(owners.ownerOf(uuid(99_999))).toBe(ALICE.id);
    expect(owners.ownerOf(uuid(0))).toBeUndefined();
  });
});
