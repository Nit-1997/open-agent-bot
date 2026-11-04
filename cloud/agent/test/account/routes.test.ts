import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_DELETE_MESSAGES } from "../../src/account/selfDelete.js";
import { makeHostedApp } from "../fixtures/hostedApp.js";
import { ADMIN, ALICE, BOB } from "../fixtures/users.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function app() {
  const h = await makeHostedApp();
  for (const u of [ALICE, BOB, ADMIN]) h.usage.store.newUser(u.email, u.id);
  return h;
}

type App = Awaited<ReturnType<typeof app>>;

const del = (h: App, user: typeof ALICE | null, b: unknown, path = "/account/delete", method = "POST") =>
  h.call(user, path, { method, body: JSON.stringify(b) });

describe("POST /account/delete", () => {
  it("deletes the session user's account with the typed email, writes the tombstone and ends their access", async () => {
    const h = await app();
    await h.usage.usage.admit(ALICE.id);
    const res = await del(h, ALICE, { confirmEmail: ALICE.email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.accounts.users.has(ALICE.id)).toBe(false);
    expect(h.accounts.users.has(BOB.id)).toBe(true);
    expect(h.accounts.removedArtifacts).toEqual([ALICE.id]);
    expect(h.forgotten).toEqual([ALICE.id]);
    expect(h.usage.store.tombstoneCount()).toBe(1);
    const after = await h.call(ALICE, "/usage");
    expect(after.status).toBe(403);
    expect(await after.json()).toMatchObject({ error: "account_disabled" });
  });

  it("uses the session user only: another user's id or email in the body or the path deletes nobody", async () => {
    const h = await app();
    const wrong = await del(h, ALICE, { confirmEmail: BOB.email, userId: BOB.id, id: BOB.id });
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({ error: "confirm_email", message: SELF_DELETE_MESSAGES.confirm });
    expect((await del(h, ALICE, { confirmEmail: BOB.email }, `/account/delete/${BOB.id}`)).status).toBe(404);
    expect((await del(h, ALICE, { confirmEmail: BOB.email }, `/account/${BOB.id}`, "DELETE")).status).toBe(404);
    expect(h.accounts.users.has(BOB.id)).toBe(true);
    expect(h.accounts.users.has(ALICE.id)).toBe(true);
    expect(h.forgotten).toEqual([]);
    expect(h.deleting.has(BOB.id)).toBe(false);
    expect(h.usage.store.tombstoneCount()).toBe(0);
  });

  it("refuses an admin with an explicit message", async () => {
    const h = await app();
    const res = await del(h, ADMIN, { confirmEmail: ADMIN.email });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "admin_self_delete", message: SELF_DELETE_MESSAGES.admin });
    expect(h.accounts.users.has(ADMIN.id)).toBe(true);
  });

  it("allows 3 attempts per user per hour, then answers 429 with retry-after", async () => {
    const h = await app();
    for (let i = 0; i < 3; i++) expect((await del(h, ALICE, { confirmEmail: "nope@example.test" })).status).toBe(422);
    const limited = await del(h, ALICE, { confirmEmail: ALICE.email });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(3500);
    expect(h.accounts.users.has(ALICE.id)).toBe(true);
    expect((await del(h, BOB, { confirmEmail: "nope@example.test" })).status).toBe(422);
  });

  it("needs a signed-in caller", async () => {
    const h = await app();
    expect((await del(h, null, { confirmEmail: ALICE.email })).status).toBe(401);
    expect(h.accounts.users.has(ALICE.id)).toBe(true);
  });
});
