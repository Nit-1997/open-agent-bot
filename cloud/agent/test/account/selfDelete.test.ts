import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletingUsers } from "../../src/account/deleting.js";
import { createSelfDelete, SELF_DELETE_MESSAGES } from "../../src/account/selfDelete.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import { RunSlots } from "../../src/limits/slots.js";
import { FakeAccounts } from "../fixtures/hostedApp.js";
import { humanCheckOff } from "../fixtures/humanCheck.js";
import { ADMIN, ALICE, BOB, CHAT_1 } from "../fixtures/users.js";
import { FakeUsageStore, monthOf } from "../limits/fakeUsage.js";

const LIMITS = { runningPerUser: 1, perHour: 10, perMonth: 50, runningServer: 8 };
const MONTH = () => monthOf(new Date());

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

function world(opts: { failAt?: string; holdTombstone?: Promise<void> } = {}) {
  const order: string[] = [];
  const accounts = new FakeAccounts();
  for (const u of [ALICE, BOB, ADMIN]) accounts.add(u);
  const store = new FakeUsageStore();
  for (const u of [ALICE, BOB, ADMIN]) store.newUser(u.email, u.id);
  const usage = store.repo({ caps: { perMonth: LIMITS.perMonth, perHour: LIMITS.perHour } });
  const deleting = new DeletingUsers();
  const policy = new HostedRunPolicy({
    limits: LIMITS,
    usage,
    slots: new RunSlots({ staleAfterMs: 340_000 }),
    humanCheck: humanCheckOff,
    limiter: new RateLimiter(),
    deleting,
  });
  const record = async (name: string, fn: () => Promise<void> = async () => {}) => {
    order.push(name);
    if (name === opts.failAt) throw new Error(`${name} down`);
    await fn();
  };
  const repo = accounts.repo();
  const auth = accounts.auth();
  const selfDelete = createSelfDelete({
    profiles: repo.users,
    removal: {
      repo: {
        ...repo,
        storage: { removeUserFiles: (id) => record("storage", () => repo.storage.removeUserFiles(id)) },
        accessRequests: { ...repo.accessRequests, deleteByEmail: (e) => record("requests", () => repo.accessRequests.deleteByEmail(e)) },
        invited: { ...repo.invited, remove: (e) => record("invited", () => repo.invited.remove(e)) },
      },
      auth: { getUser: auth.getUser, deleteUser: (id) => record("auth_user", () => auth.deleteUser(id)) },
      usage: {
        tombstone: (id) =>
          record("usage", async () => {
            await opts.holdTombstone;
            await usage.tombstone(id);
          }),
      },
    },
    deleting,
    forget: (id) => record(`forget:${id}:deleting=${deleting.has(id)}`),
    invalidate: (id) => void order.push(`invalidate:${id}`),
  });
  const admit = (u: Principal) => policy.admit({ principal: u, chatId: CHAT_1, runId: `r-${order.length}` });
  return { order, accounts, store, usage, deleting, policy, selfDelete, admit };
}

describe("self-serve account delete (D20, D23)", () => {
  it("blocks new admits and forgets the sessions first, then writes the tombstone, then removes files, requests and the auth user", async () => {
    const w = world();
    await w.selfDelete(ALICE, ` ${ALICE.email.toUpperCase()} `);
    expect(w.order).toEqual([
      `forget:${ALICE.id}:deleting=true`,
      "usage",
      "storage",
      "requests",
      "invited",
      "auth_user",
      `invalidate:${ALICE.id}`,
    ]);
    expect(w.accounts.users.has(ALICE.id)).toBe(false);
    expect(w.accounts.users.has(BOB.id)).toBe(true);
    expect(w.deleting.has(ALICE.id)).toBe(true);
  });

  it("refuses a run admitted between the delete start and the tombstone, so no charge lands after the snapshot", async () => {
    const hold = deferred();
    const w = world({ holdTombstone: hold.promise });
    const first = await w.admit(ALICE);
    if (!first.ok) throw new Error("the first run should be admitted");
    first.ticket.end();
    expect(w.store.monthCount(ALICE.id, MONTH())).toBe(1);

    const pending = w.selfDelete(ALICE, ALICE.email);
    await vi.waitFor(() => expect(w.order).toContain("usage"));
    const calls = w.usage.calls;
    const during = await w.admit(ALICE);
    expect(during.ok ? "ok" : { code: during.error.opts.code, kind: during.error.kind }).toEqual({
      code: "account_disabled",
      kind: "forbidden",
    });
    expect(w.usage.calls).toBe(calls);
    expect((await w.admit(BOB)).ok).toBe(true);

    hold.release();
    await pending;
    expect(w.store.tombstoneCount()).toBe(1);
    w.store.deleteUser(ALICE.id);
    const again = w.store.newUser(ALICE.email);
    expect(w.store.monthCount(again.id, MONTH())).toBe(1);
  });

  it("refuses a wrong or missing confirmation before touching anything", async () => {
    const w = world();
    for (const typed of [BOB.email, "", undefined, 42]) {
      await expect(w.selfDelete(ALICE, typed)).rejects.toMatchObject({
        kind: "unprocessable",
        message: SELF_DELETE_MESSAGES.confirm,
      });
    }
    expect(w.order).toEqual([]);
    expect(w.deleting.has(ALICE.id)).toBe(false);
    expect(w.accounts.users.has(ALICE.id)).toBe(true);
  });

  it("refuses an admin with an explicit message, by the token's capability or the live account role", async () => {
    const w = world();
    await expect(w.selfDelete(ADMIN, ADMIN.email)).rejects.toMatchObject({
      kind: "conflict",
      code: "admin_self_delete",
      message: SELF_DELETE_MESSAGES.admin,
    });
    const claimDropped: Principal = { ...ADMIN, capabilities: NO_CAPABILITIES };
    await expect(w.selfDelete(claimDropped, ADMIN.email)).rejects.toMatchObject({ code: "admin_self_delete" });
    expect(w.order).toEqual([]);
    expect(w.accounts.users.has(ADMIN.id)).toBe(true);
  });

  it("answers not found for a session user without a profile", async () => {
    const w = world();
    w.accounts.users.delete(BOB.id);
    await expect(w.selfDelete(BOB, BOB.email)).rejects.toMatchObject({ kind: "not_found" });
    expect(w.order).toEqual([]);
  });

  it("names the failing step, clears the deleting mark and lets runs in again", async () => {
    const w = world({ failAt: "storage" });
    await expect(w.selfDelete(ALICE, ALICE.email)).rejects.toMatchObject({
      kind: "internal",
      code: "delete_failed",
      message: SELF_DELETE_MESSAGES.failed,
      opts: { details: { step: "storage" } },
    });
    expect(w.order).toEqual([`forget:${ALICE.id}:deleting=true`, "usage", "storage"]);
    expect(w.deleting.has(ALICE.id)).toBe(false);
    expect((await w.admit(ALICE)).ok).toBe(true);
  });
});

describe("DeletingUsers", () => {
  it("is bounded, dropping the oldest id", async () => {
    const { DELETING_MAX } = await import("../../src/account/deleting.js");
    const d = new DeletingUsers();
    for (let i = 0; i <= DELETING_MAX; i++) d.add(`u${i}`);
    expect(d.has("u0")).toBe(false);
    expect(d.has(`u${DELETING_MAX}`)).toBe(true);
  });
});
