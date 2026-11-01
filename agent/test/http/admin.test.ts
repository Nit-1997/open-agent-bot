import { describe, expect, it } from "vitest";
import { makeApp } from "../fixtures/app.js";
import { ADMIN, ALICE, BOB } from "../fixtures/users.js";

async function withRequests(n: number) {
  const h = await makeApp();
  for (let i = 1; i <= n; i++) {
    await h.accounts
      .repo()
      .accessRequests.submit({ name: `Dummy ${i}`, email: `d${i}@example.test`, note: "", ipHash: Buffer.alloc(32, i) });
  }
  return h;
}

const ids = (h: Awaited<ReturnType<typeof makeApp>>) => [...h.accounts.requests.keys()];

describe("admin access requests", () => {
  it("pages requests newest first by status and validates the filter", async () => {
    const h = await withRequests(7);
    const page = (await (await h.call(ADMIN, "/admin/access-requests?status=pending&page=2")).json()) as {
      items: Array<{ name: string }>;
      total: number;
    };
    expect(page.total).toBe(7);
    expect(page.items.map((r) => r.name)).toEqual(["Dummy 2", "Dummy 1"]);
    expect((await h.call(ADMIN, "/admin/access-requests?status=bogus")).status).toBe(400);
  });

  it("approves by allowlisting the email, then inviting", async () => {
    const h = await withRequests(1);
    const [id] = ids(h);
    const res = await h.call(ADMIN, `/admin/access-requests/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ request: { status: "approved", inviteStatus: "sent" } });
    expect(h.accounts.invited.has("d1@example.test")).toBe(true);
    expect(h.accounts.sent).toEqual([{ kind: "invite", email: "d1@example.test" }]);
    const again = await h.call(ADMIN, `/admin/access-requests/${id}/approve`, { method: "POST" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_decided" });
  });

  it("records a failed invite on the row and says to resend", async () => {
    const h = await withRequests(1);
    const [id] = ids(h);
    h.accounts.failNext = "over_email_send_rate_limit";
    const res = await h.call(ADMIN, `/admin/access-requests/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "invite_failed",
      message: "Invite email failed: over_email_send_rate_limit. Use Resend invite.",
    });
    expect(h.accounts.requests.get(id)).toMatchObject({ status: "approved", inviteStatus: "failed" });
    const resent = await h.call(ADMIN, `/admin/access-requests/${id}/resend`, { method: "POST" });
    expect(await resent.json()).toMatchObject({ request: { inviteStatus: "sent" } });
  });

  it("marks a request from an existing member approved without emailing", async () => {
    const h = await makeApp();
    await h.accounts.repo().accessRequests.submit({ name: "Bob", email: "new@example.test", note: "", ipHash: Buffer.alloc(32) });
    const [id] = ids(h);
    h.accounts.add({ ...BOB, id: "44444444-4444-4444-8444-444444444444", email: "new@example.test" });
    const res = await h.call(ADMIN, `/admin/access-requests/${id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ request: { status: "approved", inviteStatus: null } });
    expect(h.accounts.requests.get(id)?.status).toBe("approved");
    expect(h.accounts.sent).toEqual([]);
    const again = await h.call(ADMIN, `/admin/access-requests/${id}/approve`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  it("rejects without email and refuses to resend a rejected request", async () => {
    const h = await withRequests(1);
    const [id] = ids(h);
    expect(await (await h.call(ADMIN, `/admin/access-requests/${id}/reject`, { method: "POST" })).json()).toMatchObject({
      request: { status: "rejected" },
    });
    const resend = await h.call(ADMIN, `/admin/access-requests/${id}/resend`, { method: "POST" });
    expect(resend.status).toBe(409);
    expect(await resend.json()).toMatchObject({ error: "not_approved" });
    expect(h.accounts.sent).toEqual([]);
  });
});

describe("admin users", () => {
  it("lists users with sign-in details and filters by email prefix", async () => {
    const h = await makeApp();
    const all = (await (await h.call(ADMIN, "/admin/users")).json()) as {
      items: Array<{ email: string; isAdmin: boolean; providers: string[] }>;
      total: number;
    };
    expect(all.total).toBe(3);
    expect(all.items[0]).toMatchObject({ email: ADMIN.email, isAdmin: true, providers: ["email"] });
    const bob = (await (await h.call(ADMIN, "/admin/users?q=bob")).json()) as { items: Array<{ email: string }> };
    expect(bob.items.map((u) => u.email)).toEqual([BOB.email]);
  });

  it("treats upper-case ids as the same user, so self-actions stay blocked", async () => {
    const h = await makeApp();
    const res = await h.call(ADMIN, `/admin/users/${ADMIN.id.toUpperCase()}/deactivate`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "self_action" });
    const other = await h.call(ADMIN, `/admin/users/${ALICE.id.toUpperCase()}/deactivate`, { method: "POST" });
    expect(await other.json()).toMatchObject({ user: { id: ALICE.id, status: "deactivated" } });
    expect((await h.call(ALICE, "/profile")).status).toBe(403);
    expect((await h.call(ADMIN, "/admin/users/not-a-uuid/deactivate", { method: "POST" })).status).toBe(404);
  });

  it("deactivates a user, which blocks their next request, and reactivates them", async () => {
    const h = await makeApp();
    expect((await h.call(ALICE, "/profile")).status).toBe(200);
    const off = await h.call(ADMIN, `/admin/users/${ALICE.id}/deactivate`, { method: "POST" });
    expect(await off.json()).toMatchObject({ user: { status: "deactivated" } });
    expect(h.accounts.users.get(ALICE.id)?.account.bannedUntil).not.toBeNull();
    expect((await h.call(ALICE, "/profile")).status).toBe(403);
    await h.call(ADMIN, `/admin/users/${ALICE.id}/reactivate`, { method: "POST" });
    expect((await h.call(ALICE, "/profile")).status).toBe(200);
  });

  it("refuses actions on the admin's own account", async () => {
    const h = await makeApp();
    for (const [method, path] of [
      ["POST", `/admin/users/${ADMIN.id}/deactivate`],
      ["DELETE", `/admin/users/${ADMIN.id}`],
    ]) {
      const res = await h.call(ADMIN, path, { method, body: JSON.stringify({ confirmEmail: ADMIN.email }) });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "self_action" });
    }
  });

  it("deletes a user only with the typed email, removing files, requests and the account", async () => {
    const h = await makeApp();
    await h.accounts.repo().accessRequests.submit({ name: "Bob", email: BOB.email, note: "", ipHash: Buffer.alloc(32) });
    const wrong = await h.call(ADMIN, `/admin/users/${BOB.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmEmail: "x@example.test" }),
    });
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({ error: "invalid" });
    const ok = await h.call(ADMIN, `/admin/users/${BOB.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmEmail: BOB.email.toUpperCase() }),
    });
    expect(await ok.json()).toEqual({ ok: true });
    expect(h.accounts.removedArtifacts).toEqual([BOB.id]);
    expect(h.accounts.users.has(BOB.id)).toBe(false);
    expect([...h.accounts.requests.values()].some((r) => r.email === BOB.email)).toBe(false);
    expect((await h.call(ADMIN, `/admin/users/${BOB.id}/deactivate`, { method: "POST" })).status).toBe(404);
  });

  it("reports the step a delete failed at", async () => {
    const h = await makeApp();
    const repo = h.accounts.repo();
    const { createAdminService } = await import("../../src/admin/service.js");
    const admin = createAdminService({
      repo: { ...repo, storage: { removeUserFiles: async () => Promise.reject(new Error("storage down")) } },
      auth: h.accounts.auth(),
      hooks: { onDisabled: async () => {}, onEnabled: () => {} },
    });
    const quiet = (await import("vitest")).vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(admin.remove(ADMIN, BOB.id, BOB.email)).rejects.toMatchObject({
      kind: "internal",
      code: "delete_failed",
      opts: { details: { step: "storage" } },
    });
    quiet.mockRestore();
  });
});
