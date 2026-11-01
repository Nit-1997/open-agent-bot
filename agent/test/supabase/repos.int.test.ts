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
      { role: "assistant", content: "hello", status: "interrupted" },
    ]);
    await ra.chats.touch(chat, { titleIfEmpty: "hi" });
    expect((await ra.messages.history(chat)).items.map((m) => m.content)).toEqual(["hi", "hello"]);
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
});
