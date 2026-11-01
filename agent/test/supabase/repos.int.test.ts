import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { createVerifier } from "../../src/auth/verify.js";
import { parseCredentialKeys } from "../../src/config.js";
import { LocalKeyWrapper } from "../../src/crypto/keyWrapper.js";
import { forUser } from "../../src/db/users.js";
import { SupabaseProfileStore } from "../../src/profile/store.js";
import { SupabaseCredentialStore } from "../../src/providers/credentialStore.js";
import { VersionConflict } from "../../src/workspace/conflict.js";
import {
  adminRepo,
  createBareUser,
  createTestUser,
  deleteCreatedUsers,
  enabled,
  env,
  remainingRows,
  service,
  type TestUser,
  testEmail,
} from "./helpers.js";

const wrapper = new LocalKeyWrapper(parseCredentialKeys(`v1:${randomBytes(32).toString("base64")}`));

describe.skipIf(!enabled)("Supabase repositories (live project)", () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    [a, b] = await Promise.all([createTestUser(), createTestUser()]);
  }, 60_000);

  afterAll(async () => {
    expect(await remainingRows(await deleteCreatedUsers())).toBe(0);
  }, 60_000);

  it("verifies a real access token with the agent's verifier", async () => {
    const user = await createVerifier({ supabaseUrl: env.SUPABASE_URL })(a.accessToken);
    expect(user).toMatchObject({ id: a.id, email: a.email, isAdmin: false });
  });

  it("creates a profile row on sign-up and round-trips the profile", async () => {
    const store = new SupabaseProfileStore(forUser(service(), a.id).profiles);
    expect((await store.get()).name).toBeUndefined();
    await store.put({ name: "Integration", food: ["Vegan"] });
    expect(await store.get()).toMatchObject({ name: "Integration", food: ["Vegan"] });
    await expect(store.put({ travel: { style: "jet" } })).rejects.toThrow(/isn't valid/);
    expect((await adminRepo().users.findByEmail(a.email))?.status).toBe("active");
  });

  it("stores credentials as real bytea and serializes concurrent modifies", async () => {
    const store = new SupabaseCredentialStore(a.id, forUser(service(), a.id).credentials, wrapper);
    await store.modify("openrouter", async () => ({ type: "api_key", key: "sk-or-v1-integration0123456789" }));
    expect(await store.read("openrouter")).toEqual({ type: "api_key", key: "sk-or-v1-integration0123456789" });
    const { data } = await service().from("provider_credentials").select("hint, key_version, ciphertext").eq("user_id", a.id).single();
    expect(data).toMatchObject({ hint: "sk-or-…6789", key_version: 1 });
    expect(String(data?.ciphertext)).toMatch(/^\\x[0-9a-f]+$/);
    const seen: string[] = [];
    await Promise.all(
      ["one", "two"].map((tag) =>
        store.modify("openrouter", async (cur) => {
          seen.push((cur as { key: string }).key);
          return { type: "api_key", key: `sk-or-v1-${tag}-0123456789abcdef` };
        }),
      ),
    );
    expect(seen[1]).toBe("sk-or-v1-one-0123456789abcdef");
    expect(await new SupabaseCredentialStore(b.id, forUser(service(), b.id).credentials, wrapper).read("openrouter")).toBeUndefined();
    await store.delete("openrouter");
    expect(await store.read("openrouter")).toBeUndefined();
  });

  it("claims chats for their owner only and keeps workspace versions in step", async () => {
    const chat = randomUUID();
    const ra = forUser(service(), a.id);
    const rb = forUser(service(), b.id);
    await ra.chats.claim(chat, { model: "openrouter/x" });
    await ra.chats.claim(chat, {});
    await expect(rb.chats.claim(chat, {})).rejects.toMatchObject({ kind: "not_found" });
    expect(await ra.workspace.put(chat, "event", "main", { title: "x", guests: 2 })).toBe(1);
    expect(await ra.workspace.put(chat, "event", "main", { title: "x", guests: 3 }, 1)).toBe(2);
    const stale = await ra.workspace.put(chat, "event", "main", { title: "x", guests: 4 }, 1).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(VersionConflict);
    expect((stale as VersionConflict).actual).toBe(2);
    expect(await ra.workspace.put(chat, "trip", "new", { destination: "y" }, 0)).toBe(1);
    await expect(rb.workspace.put(chat, "event", "main", { title: "y", guests: 1 })).rejects.toMatchObject({ kind: "not_found" });
    expect(await rb.workspace.list(chat)).toEqual([]);
    expect((await ra.workspace.list(chat)).map((e) => e.kind).sort()).toEqual(["event", "trip"]);
    await ra.messages.append(chat, "run-1", [
      { role: "user", content: "hi", status: "complete" },
      {
        role: "assistant",
        content: "hello",
        status: "interrupted",
        parts: [{ type: "tool", id: "c1", name: "create_artifact", args: "{}" }],
      },
    ]);
    await ra.chats.touch(chat, { titleIfEmpty: "hi" });
    expect((await ra.messages.history(chat)).items.map((m) => [m.content, m.parts])).toEqual([
      ["hi", undefined],
      ["hello", [{ type: "tool", id: "c1", name: "create_artifact", args: "{}" }]],
    ]);
    expect((await ra.chats.page(1)).items[0]).toMatchObject({ id: chat, title: "hi" });
    expect(await rb.chats.exists(chat)).toBe(false);
    expect((await rb.messages.history(chat)).total).toBe(0);
  });

  it("uploads artifacts as text/html and application/pdf and keeps them private to the owner", async () => {
    const store = new ArtifactStore(async () => Buffer.from("%PDF-1.4 integration"));
    const ra = forUser(service(), a.id);
    const { id } = await store.save(ra, null, "Integration report", "<h1>Hi</h1>");
    expect(await store.get(ra, id)).toEqual({ title: "Integration report", html: "<h1>Hi</h1>" });
    expect((await store.renderPdf(ra, id))?.pdf.toString()).toContain("%PDF");
    expect((await ra.artifacts.get(id))?.pdfReady).toBe(true);
    expect(await store.get(forUser(service(), b.id), id)).toBeNull();
    const { data } = await service().storage.from("artifacts").list(a.id);
    expect(data?.map((o) => o.name).sort()).toEqual([`${id}.html`, `${id}.pdf`]);
  });

  it("runs access_request_submit with the documented outcomes and the per-IP cap", async () => {
    const repo = adminRepo();
    const ip = randomBytes(32);
    const email = testEmail();
    expect(await repo.accessRequests.submit({ name: "T", email, note: "", ipHash: ip })).toBe("inserted");
    expect(await repo.accessRequests.submit({ name: "T", email, note: "", ipHash: randomBytes(32) })).toBe("duplicate");
    expect(await repo.accessRequests.submit({ name: "T", email: a.email, note: "", ipHash: randomBytes(32) })).toBe("already_member");
    expect(await repo.accessRequests.submit({ name: "T", email: testEmail(), note: "", ipHash: ip })).toBe("inserted");
    expect(await repo.accessRequests.submit({ name: "T", email: testEmail(), note: "", ipHash: ip })).toBe("inserted");
    expect(await repo.accessRequests.submit({ name: "T", email: testEmail(), note: "", ipHash: ip })).toBe("rate_limited_ip");
    const page = await repo.accessRequests.page("pending", 1);
    expect(page.items[0].ipHashPrefix).toBe(ip.toString("hex").slice(0, 8));
    await service().from("access_requests").delete().like("email", "oab-test+%@example.test");
  });
  it("pages a user's chats newest first: page 2 holds the two oldest of 22, and a page past the end is empty", async () => {
    const c = await createBareUser();
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    const rows = Array.from({ length: 22 }, (_, i) => ({ id: randomUUID(), user_id: c.id, title: `chat ${i}`, last_message_at: at(i) }));
    const { error } = await service().from("chats").insert(rows);
    expect(error).toBeNull();
    const repo = forUser(service(), c.id).chats;
    const page = await repo.page(2);
    expect(page.total).toBe(22);
    expect(page.items.map((r) => r.title)).toEqual(["chat 1", "chat 0"]);
    expect((await repo.page(1)).items.map((r) => r.title).slice(0, 3)).toEqual(["chat 21", "chat 20", "chat 19"]);
    expect(await repo.page(9)).toEqual({ items: [], total: 22 });
  });

  it("pages access requests newest first: page 2 continues where page 1 stopped", async () => {
    const db = service();
    const at = (i: number) => new Date(Date.UTC(2100, 0, 1, 0, i)).toISOString();
    const rows = Array.from({ length: 7 }, (_, i) => ({
      name: `order ${i}`,
      email: testEmail(),
      note: "",
      ip_hash: `\\x${randomBytes(32).toString("hex")}`,
      created_at: at(i),
    }));
    try {
      const { error } = await db.from("access_requests").insert(rows);
      expect(error).toBeNull();
      const repo = adminRepo();
      const first = await repo.accessRequests.page("pending", 1);
      const second = await repo.accessRequests.page("pending", 2);
      expect(first.items.map((r) => r.name)).toEqual(["order 6", "order 5", "order 4", "order 3", "order 2"]);
      expect(second.items.slice(0, 2).map((r) => r.name)).toEqual(["order 1", "order 0"]);
      expect(second.total).toBe(first.total);
    } finally {
      await db
        .from("access_requests")
        .delete()
        .in(
          "email",
          rows.map((r) => r.email),
        );
    }
  });

  it("reads one chat, chat titles, reports with their chats and plans across chats", async () => {
    const ra = forUser(service(), (await createBareUser()).id);
    const rb = forUser(service(), b.id);
    const c1 = randomUUID();
    const c2 = randomUUID();
    await ra.chats.claim(c1, {});
    await ra.chats.touch(c1, { titleIfEmpty: "Plans one" });
    await ra.chats.claim(c2, {});
    expect(await ra.chats.get(c1)).toMatchObject({ id: c1, title: "Plans one" });
    expect(await rb.chats.get(c1)).toBeUndefined();
    expect(await ra.chats.titles([c1, c2, randomUUID()])).toEqual(
      new Map([
        [c1, "Plans one"],
        [c2, ""],
      ]),
    );
    expect((await rb.chats.titles([c1])).size).toBe(0);

    await ra.artifacts.insert({ id: "intRepA00001", chatId: c1, title: "First", sizeBytes: 10 });
    await ra.artifacts.insert({ id: "intRepA00002", chatId: c2, title: "Second", sizeBytes: 20 });
    const reports = await ra.artifacts.page(1);
    expect(reports.total).toBe(2);
    expect(reports.items.map((r) => r.id)).toEqual(["intRepA00002", "intRepA00001"]);
    expect(await ra.artifacts.page(50)).toEqual({ items: [], total: 2 });
    expect(await rb.artifacts.summary("intRepA00001")).toBeUndefined();
    await service().from("chats").delete().eq("id", c2);
    expect((await ra.artifacts.summary("intRepA00002"))?.chatId).toBeNull();

    await ra.workspace.put(c1, "trip", "t1", { destination: "Big Sur", start: "a", end: "b", travelers: 2, stays: [], days: [] });
    await ra.workspace.put(c1, "event", "e1", { title: "Party", guests: 3 });
    const all = await ra.workspace.page(1);
    expect(all.total).toBe(2);
    expect(all.items.map((e) => e.kind)).toEqual(["event", "trip"]);
    expect(all.items[0].chatId).toBe(c1);
    const trips = await ra.workspace.page(1, "trip");
    expect(trips.items.map((e) => e.id)).toEqual(["t1"]);
    expect(await ra.workspace.counts()).toEqual({ cart: 0, trip: 1, event: 1, shortlist: 0 });
    expect((await rb.workspace.page(1)).total).toBe(0);
  });
});
