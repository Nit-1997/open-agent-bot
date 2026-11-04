import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminRepo } from "../../src/store/admin.js";
import { createServiceClient } from "../../src/store/client.js";
import { forUser } from "../../src/store/users.js";
import { earlierCards } from "@oab/core/workspace/earlier.js";
import { ALICE, CHAT_1 } from "../fixtures/users.js";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;
type Call = { method: string; path: string; params: Record<string, string[]>; prefer: string; body: unknown };

function stub(replies: Reply[]) {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const params: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) params[k] = [...(params[k] ?? []), v];
    const headers = new Headers(init.headers);
    const raw = typeof init.body === "string" ? init.body : undefined;
    calls.push({
      method: init.method ?? "GET",
      path: url.pathname,
      params,
      prefer: headers.get("prefer") ?? "",
      body: raw ? JSON.parse(raw) : undefined,
    });
    const reply = queue.shift();
    if (!reply) throw new Error(`unexpected ${init.method ?? "GET"} ${url.pathname}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof globalThis.fetch;
  const db = createServiceClient({ supabaseUrl: "https://stub.supabase.test", supabaseSecretKey: "sb_secret_test" }, { fetch });
  return { db, calls, left: () => queue.length };
}

const one = (call: Call, key: string) => call.params[key]?.[0];

const requestRow = (over: Record<string, unknown> = {}) => ({
  id: "44444444-4444-4444-8444-444444444444",
  name: "Dee",
  email: "dee@example.test",
  note: "",
  status: "pending",
  invite_status: null,
  invite_error: null,
  ip_hash: "\\x0a0b0c0d0e",
  created_at: "2026-11-01T00:00:00Z",
  decided_at: null,
  ...over,
});

const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("admin repo against PostgREST", () => {
  it("pages access requests newest first with offset, limit and an exact count", async () => {
    const s = stub([{ body: [requestRow()], headers: { "content-range": "5-5/12" } }]);
    const page = await createAdminRepo(s.db).accessRequests.page("pending", 2);
    expect(page).toEqual({
      items: [expect.objectContaining({ id: REQUEST_ID, status: "pending", ipHashPrefix: "0a0b0c0d", inviteStatus: null })],
      total: 12,
    });
    const [call] = s.calls;
    expect(call.path).toBe("/rest/v1/access_requests");
    expect(one(call, "order")).toBe("created_at.desc,id.desc");
    expect(one(call, "offset")).toBe("5");
    expect(one(call, "limit")).toBe("5");
    expect(one(call, "status")).toBe("eq.pending");
    expect(call.prefer).toContain("count=exact");
  });

  it("does not filter by status for all", async () => {
    const s = stub([{ body: [], headers: { "content-range": "*/0" } }]);
    expect(await createAdminRepo(s.db).accessRequests.page("all", 1)).toEqual({ items: [], total: 0 });
    expect(s.calls[0].params.status).toBeUndefined();
    expect(one(s.calls[0], "offset")).toBe("0");
  });

  it("pages users newest first and escapes LIKE wildcards in the search prefix", async () => {
    const s = stub([
      {
        body: [{ user_id: ALICE.id, email: "a_b%c\\x@example.test", status: "active", created_at: "2026-11-01T00:00:00Z" }],
        headers: { "content-range": "5-5/6" },
      },
    ]);
    const page = await createAdminRepo(s.db).users.page(2, "A_B%C\\");
    expect(page.total).toBe(6);
    expect(page.items[0]).toEqual({ id: ALICE.id, email: "a_b%c\\x@example.test", status: "active", createdAt: "2026-11-01T00:00:00Z" });
    const [call] = s.calls;
    expect(call.path).toBe("/rest/v1/profiles");
    expect(one(call, "order")).toBe("created_at.desc,user_id.desc");
    expect(one(call, "email")).toBe("like.a\\_b\\%c\\\\%");
    expect([one(call, "offset"), one(call, "limit")]).toEqual(["5", "5"]);
  });

  it("refuses an unknown status value instead of passing it on", async () => {
    const s = stub([{ body: [{ status: "weird" }] }]);
    await expect(createAdminRepo(s.db).users.status(ALICE.id)).rejects.toThrow(/unexpected profiles.status/);
  });

  it("does not retry a coded error", async () => {
    const s = stub([{ status: 400, body: { code: "22P02", message: "bad", details: null, hint: null } }]);
    await expect(createAdminRepo(s.db).accessRequests.get(REQUEST_ID)).rejects.toMatchObject({ kind: "invalid" });
    expect(s.calls).toHaveLength(1);
  });

  it("retries a read once after a network failure", async () => {
    const s = stub([new TypeError("fetch failed"), { body: [requestRow()] }]);
    expect(await createAdminRepo(s.db).accessRequests.get(REQUEST_ID)).toMatchObject({ id: REQUEST_ID });
    expect(s.calls).toHaveLength(2);
  });

  it("gives up after exactly two attempts when the data service stays unreachable", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const s = stub(Array.from({ length: 10 }, () => new TypeError("fetch failed")));
      const pending = createAdminRepo(s.db).accessRequests.get(REQUEST_ID);
      const settled = pending.catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await settled).toMatchObject({ kind: "unavailable" });
      expect(s.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells an already decided request apart from a missing one when no row was updated", async () => {
    const decided = stub([{ body: [] }, { body: [requestRow({ status: "approved" })] }]);
    await expect(
      createAdminRepo(decided.db).accessRequests.decide(REQUEST_ID, { status: "rejected", decidedBy: ALICE.id }),
    ).rejects.toMatchObject({ kind: "conflict", code: "already_decided" });
    expect(decided.calls.map((c) => c.method)).toEqual(["PATCH", "GET"]);
    expect(one(decided.calls[0], "status")).toBe("eq.pending");

    const missing = stub([{ body: [] }, { body: [] }]);
    await expect(
      createAdminRepo(missing.db).accessRequests.decide(REQUEST_ID, { status: "rejected", decidedBy: ALICE.id }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("reports a missing request on setInvite without a second lookup", async () => {
    const s = stub([{ body: [] }]);
    await expect(
      createAdminRepo(s.db).accessRequests.setInvite(REQUEST_ID, { inviteStatus: "sent", inviteError: null }, null),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].params.status).toBeUndefined();
  });

  it("removes a user's files page by page until the folder is empty", async () => {
    const s = stub([{ body: [{ name: "a.html" }, { name: "a.pdf" }] }, { body: [] }, { body: [] }]);
    await createAdminRepo(s.db).storage.removeUserFiles(ALICE.id);
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /storage/v1/object/list/artifacts",
      "DELETE /storage/v1/object/artifacts",
      "POST /storage/v1/object/list/artifacts",
    ]);
    expect(s.calls[0].body).toMatchObject({ prefix: ALICE.id, offset: 0 });
    expect(s.calls[1].body).toEqual({ prefixes: [`${ALICE.id}/a.html`, `${ALICE.id}/a.pdf`] });
  });
});

describe("user repos against PostgREST", () => {
  it("pages chats by last message, newest first, scoped to the user", async () => {
    const s = stub([
      { body: [{ id: CHAT_1, title: "T", last_message_at: "2026-11-01T00:00:00Z" }], headers: { "content-range": "20-20/21" } },
    ]);
    expect(await forUser(s.db, ALICE.id).chats.page(2)).toEqual({
      items: [{ id: CHAT_1, title: "T", lastMessageAt: "2026-11-01T00:00:00Z" }],
      total: 21,
    });
    const [call] = s.calls;
    expect(one(call, "order")).toBe("last_message_at.desc,id.desc");
    expect(one(call, "user_id")).toBe(`eq.${ALICE.id}`);
    expect([one(call, "offset"), one(call, "limit")]).toEqual(["20", "20"]);
  });

  it("answers a page past the end with no rows and the real total", async () => {
    const s = stub([
      { status: 416, body: { code: "PGRST103", message: "Requested range not satisfiable", details: null, hint: null } },
      { body: [], headers: { "content-range": "*/21" } },
    ]);
    expect(await forUser(s.db, ALICE.id).chats.page(9)).toEqual({ items: [], total: 21 });
    expect(s.calls[1].method).toBe("HEAD");
  });

  it("reads the earlier cards past malformed parts", async () => {
    const cart = {
      kind: "cart",
      stores: [{ name: "Target", total: 5, url: "https://www.target.com/", missing: [], items: [{ query: "salsa", qty: 1, picks: [] }] }],
    };
    const card = [{ type: "tool", id: "w-widget", name: "show_widget", args: JSON.stringify({ widget: cart }) }];
    const row = (parts: unknown) => ({ role: "assistant", content: "", status: "complete", created_at: "2026-11-01T00:00:00Z", parts });
    const s = stub([{ body: [row({ type: "text" }), row("x"), row(null), row(card), row(7)], headers: { "content-range": "0-4/5" } }]);
    const { items } = await forUser(s.db, ALICE.id).messages.history(CHAT_1);
    expect(earlierCards(items).cart?.card.stores[0].name).toBe("Target");
  });

  it("saves message parts and reads them back, dropping malformed ones", async () => {
    const parts = [
      { type: "tool", id: "c2", name: "create_artifact", args: '{"title":"T"}', result: "artifact abcdefghijkl created: T" },
      { type: "text", text: "Here it is." },
    ] as const;
    const row = (p: unknown) => ({
      role: "assistant",
      content: "Here it is.",
      status: "complete",
      created_at: "2026-11-01T00:00:00Z",
      parts: p,
    });
    const s = stub([{ status: 201 }, { body: [row(null), row([{ type: "tool" }]), row(parts)], headers: { "content-range": "0-2/3" } }]);
    const r = forUser(s.db, ALICE.id);
    await r.messages.append(CHAT_1, "run", [
      { role: "user", content: "hi", status: "complete" },
      { role: "assistant", content: "Here it is.", status: "complete", parts: [...parts] },
    ]);
    expect(s.calls[0].body).toEqual([
      { chat_id: CHAT_1, user_id: ALICE.id, run_id: "run", role: "user", content: "hi", status: "complete" },
      { chat_id: CHAT_1, user_id: ALICE.id, run_id: "run", role: "assistant", content: "Here it is.", status: "complete", parts },
    ]);
    const { items } = await r.messages.history(CHAT_1);
    expect(items.map((m) => m.parts)).toEqual([parts, undefined, undefined]);
    expect(one(s.calls[1], "select")).toContain("parts");
  });

  it("guards credential updates by version", async () => {
    const row = {
      provider: "openrouter",
      kind: "api_key" as const,
      ciphertext: Buffer.alloc(20, 1),
      nonce: Buffer.alloc(12, 2),
      dekWrapped: Buffer.alloc(48, 3),
      dekNonce: Buffer.alloc(12, 4),
      keyVersion: 1,
      hint: "sk-…1234",
    };
    const s = stub([{ body: [] }, { body: [{ version: 3 }] }]);
    const creds = forUser(s.db, ALICE.id).credentials;
    expect(await creds.update(row, 2)).toBe(false);
    expect(await creds.update(row, 2)).toBe(true);
    const [call] = s.calls;
    expect(call.method).toBe("PATCH");
    expect(one(call, "version")).toBe("eq.2");
    expect(one(call, "provider")).toBe("eq.openrouter");
    expect(one(call, "user_id")).toBe(`eq.${ALICE.id}`);
    expect(call.body).toMatchObject({ version: 3, ciphertext: `\\x${"01".repeat(20)}` });
  });

  it("reads provider settings without writing when the row exists", async () => {
    const s = stub([{ body: [{ data: { custom: {} }, device_id: "d1", updated_at: "t1" }] }]);
    expect(await forUser(s.db, ALICE.id).providerSettings.get()).toEqual({ data: { custom: {} }, deviceId: "d1", stamp: "t1" });
    expect(s.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("creates provider settings once when the row is missing", async () => {
    const s = stub([{ body: [] }, { status: 201, body: [] }, { body: [{ data: {}, device_id: "d2", updated_at: "t0" }] }]);
    expect(await forUser(s.db, ALICE.id).providerSettings.get()).toMatchObject({ deviceId: "d2", stamp: "t0" });
    expect(s.calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
    expect(s.calls[1].prefer).toContain("resolution=ignore-duplicates");
  });

  it("writes provider settings only over the version it read", async () => {
    const s = stub([{ body: [] }, { body: [{ updated_at: "t2" }] }]);
    const settings = forUser(s.db, ALICE.id).providerSettings;
    await expect(settings.put({ custom: {} }, "t1")).rejects.toMatchObject({ kind: "conflict", code: "settings_changed" });
    expect(await settings.put({ custom: {} }, "t1")).toBe("t2");
    expect(one(s.calls[0], "updated_at")).toBe("eq.t1");
    expect(one(s.calls[0], "user_id")).toBe(`eq.${ALICE.id}`);
  });

  it("refuses ids that aren't lowercase UUIDs", () => {
    const s = stub([]);
    expect(() => forUser(s.db, CHAT_1.toUpperCase())).toThrow(/verified user id/);
    expect(() => forUser(s.db, "nope")).toThrow(/verified user id/);
  });
});
