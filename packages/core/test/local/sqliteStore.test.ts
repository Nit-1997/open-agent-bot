import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqliteStore } from "../../src/local/store/sqliteStore.js";
import { artifactId } from "../contract/store.js";
import { openWithUser, tempDir } from "./storeHarness.js";

const count = (path: string, table: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const n = Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  db.close();
  return n;
};

describe("SqliteStore", () => {
  let tmp: ReturnType<typeof tempDir>;
  let dbPath: string;
  beforeEach(() => {
    tmp = tempDir("oab-store-");
    dbPath = join(tmp.dir, "open-agent.db");
  });
  afterEach(() => tmp.dispose());

  it("seeds a user idempotently with one user, one empty profile and nothing else", async () => {
    const store = openSqliteStore({ dir: tmp.dir });
    const id = randomUUID();
    store.ensureUser(id, "someone@open-agent.invalid");
    store.ensureUser(id, "someone@open-agent.invalid");
    expect(await store.forUser(id).profiles.get()).toEqual({});
    await store.close();
    expect(count(dbPath, "users")).toBe(1);
    expect(count(dbPath, "profiles")).toBe(1);
    for (const t of ["chats", "chat_messages", "artifacts", "provider_settings", "provider_credentials"]) expect(count(dbPath, t)).toBe(0);
  });

  it("refuses to seed a malformed user id", async () => {
    const store = openSqliteStore({ dir: tmp.dir });
    expect(() => store.ensureUser("not-a-uuid", "x@open-agent.invalid")).toThrow();
    expect(() => store.ensureUser(randomUUID().toUpperCase(), "x@open-agent.invalid")).toThrow();
    await store.close();
  });

  it("keeps every repo's data across close and reopen, and checkpoints the WAL on close", async () => {
    const { store, userId } = openWithUser({ dir: tmp.dir });
    const r = store.forUser(userId);
    const chat = randomUUID();
    await r.chats.claim(chat, { model: "openai/gpt" });
    await r.chats.touch(chat, { titleIfEmpty: "Persisted chat" });
    await r.messages.append(chat, "run-1", [
      { role: "user", content: "hello", status: "complete" },
      { role: "assistant", content: "hi", status: "interrupted", parts: [{ type: "text", text: "hi" }] },
    ]);
    const report = artifactId();
    await r.artifacts.insert({ id: report, chatId: chat, title: "Persisted report", sizeBytes: 42 });
    await r.artifacts.setPdf(report);
    await r.storage.upload(report, "html", Buffer.from("<p>kept</p>"));
    await r.profiles.putData({ name: "Kept" });
    const stamp = await r.providerSettings.put(
      { custom: {}, enabled: { openai: true }, hidden: [] },
      (await r.providerSettings.get()).stamp,
    );
    const credential = {
      provider: "openai",
      kind: "api_key" as const,
      hint: "sk-…keep",
      ciphertext: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(12, 2),
      dekWrapped: Buffer.alloc(48, 3),
      dekNonce: Buffer.alloc(12, 4),
      keyVersion: 1,
    };
    await r.credentials.insert(credential);
    const before = {
      chats: await r.chats.page(1),
      history: await r.messages.history(chat),
      artifacts: await r.artifacts.page(1),
      settings: await r.providerSettings.get(),
    };
    await store.close();
    expect(!existsSync(`${dbPath}-wal`) || statSync(`${dbPath}-wal`).size === 0).toBe(true);

    const reopened = openSqliteStore({ dir: tmp.dir });
    const again = reopened.forUser(userId);
    expect(await again.chats.page(1)).toEqual(before.chats);
    expect(await again.messages.history(chat)).toEqual(before.history);
    expect(await again.artifacts.page(1)).toEqual(before.artifacts);
    expect(await again.providerSettings.get()).toEqual(before.settings);
    expect(before.settings.stamp).toBe(stamp);
    expect(await again.profiles.get()).toEqual({ name: "Kept" });
    expect(await again.credentials.read("openai")).toEqual({ ...credential, version: 1 });
    expect((await again.storage.download(report, "html"))?.toString()).toBe("<p>kept</p>");
    expect(reopened.credentialCount()).toBe(1);
    await reopened.close();
  });

  it("ends 50 parallel appends and touches on two chats with consistent counts and no busy errors", async () => {
    const { store, userId } = openWithUser({ dir: tmp.dir });
    const second = openSqliteStore({ dir: tmp.dir });
    const chats = [randomUUID(), randomUUID()];
    for (const c of chats) await store.forUser(userId).chats.claim(c, {});
    const ops = Array.from({ length: 50 }, (_, i) => {
      const repos = (i % 4 < 2 ? store : second).forUser(userId);
      const chat = chats[i % 2]!;
      return [
        repos.messages.append(chat, `run-${i}`, [{ role: "user", content: `m${i}`, status: "complete" }]),
        repos.chats.touch(chat, {}),
      ];
    }).flat();
    const results = await Promise.allSettled(ops);
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const r = store.forUser(userId);
    expect((await r.messages.history(chats[0]!)).total).toBe(25);
    expect((await r.messages.history(chats[1]!)).total).toBe(25);
    expect((await r.chats.page(1)).total).toBe(2);
    await second.close();
    await store.close();
  });

  it("counts and resets credentials across users", async () => {
    const { store, userId } = openWithUser({ dir: tmp.dir });
    const other = randomUUID();
    store.ensureUser(other, "other@open-agent.invalid");
    const row = (provider: string) => ({
      provider,
      kind: "api_key" as const,
      hint: "sk-…",
      ciphertext: Buffer.alloc(20, 1),
      nonce: Buffer.alloc(12),
      dekWrapped: Buffer.alloc(48),
      dekNonce: Buffer.alloc(12),
      keyVersion: 1,
    });
    await store.forUser(userId).credentials.insert(row("openai"));
    await store.forUser(userId).credentials.insert(row("groq"));
    await store.forUser(other).credentials.insert(row("openai"));
    expect(store.credentialCount()).toBe(3);
    expect(store.resetCredentials()).toBe(3);
    expect(store.credentialCount()).toBe(0);
    expect(await store.forUser(userId).credentials.list()).toEqual([]);
    await store.close();
  });

  it("closes idempotently", async () => {
    const store = openSqliteStore({ dir: tmp.dir });
    await store.close();
    await expect(store.close()).resolves.toBeUndefined();
  });
});
