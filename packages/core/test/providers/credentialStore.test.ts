import { describe, expect, it, vi } from "vitest";
import { SupabaseCredentialStore } from "../../src/providers/credentialStore.js";
import { wrapper } from "../fixtures/app.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE, BOB } from "../fixtures/users.js";

const oauth = { type: "oauth" as const, refresh: "r1", access: "a1", expires: 1, email: "me@example.com" };

describe("SupabaseCredentialStore", () => {
  it("round-trips credentials encrypted and lists them without decrypting", async () => {
    const db = new MemoryDb();
    const s = new SupabaseCredentialStore(ALICE.id, db.forUser(ALICE.id).credentials, wrapper);
    await s.modify("openai", async () => oauth);
    expect(await s.read("openai")).toEqual(oauth);
    expect(await s.list()).toEqual([{ providerId: "openai", type: "oauth" }]);
    expect(await s.listings()).toEqual([{ provider: "openai", kind: "oauth", hint: "Signed in · me@example.com" }]);
    expect(await s.read("groq")).toBeUndefined();
    await s.delete("openai");
    expect(await s.read("openai")).toBeUndefined();
  });

  it("passes the current value to modify and leaves it alone when fn returns undefined", async () => {
    const s = new SupabaseCredentialStore(ALICE.id, new MemoryDb().forUser(ALICE.id).credentials, wrapper);
    await s.modify("groq", async () => ({ type: "api_key", key: "gsk_1" }));
    const seen = vi.fn(async () => undefined);
    expect(await s.modify("groq", seen)).toEqual({ type: "api_key", key: "gsk_1" });
    expect(seen).toHaveBeenCalledWith({ type: "api_key", key: "gsk_1" });
  });

  it("serializes concurrent modifies so the second sees the first's value", async () => {
    const s = new SupabaseCredentialStore(ALICE.id, new MemoryDb().forUser(ALICE.id).credentials, wrapper);
    const seen: unknown[] = [];
    await Promise.all([
      s.modify("openai", async (cur) => {
        seen.push(cur);
        await new Promise((r) => setTimeout(r, 5));
        return { ...oauth, access: "first" };
      }),
      s.modify("openai", async (cur) => {
        seen.push(cur);
        return { ...oauth, access: "second" };
      }),
    ]);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toMatchObject({ access: "first" });
    expect((await s.read("openai")) as { access: string }).toMatchObject({ access: "second" });
  });

  it("retries once when another writer wins, then gives up with a conflict", async () => {
    const db = new MemoryDb();
    const repo = db.forUser(ALICE.id).credentials;
    const s = new SupabaseCredentialStore(ALICE.id, repo, wrapper);
    await s.modify("openai", async () => oauth);
    const update = vi.spyOn(repo, "update").mockResolvedValueOnce(false);
    await s.modify("openai", async () => ({ ...oauth, access: "a2" }));
    expect(update).toHaveBeenCalledTimes(2);
    update.mockResolvedValue(false);
    await expect(s.modify("openai", async () => ({ ...oauth, access: "a3" }))).rejects.toMatchObject({ kind: "conflict" });
  });

  it("treats a row that fails its integrity check, or that belongs to someone else, as not configured", async () => {
    const db = new MemoryDb();
    const alice = new SupabaseCredentialStore(ALICE.id, db.forUser(ALICE.id).credentials, wrapper);
    await alice.modify("groq", async () => ({ type: "api_key", key: "gsk_1" }));
    const row = db.credentials.get(`${ALICE.id}\0groq`)!;
    db.credentials.set(`${BOB.id}\0groq`, { ...row, userId: BOB.id });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await new SupabaseCredentialStore(BOB.id, db.forUser(BOB.id).credentials, wrapper).read("groq")).toBeUndefined();
    row.ciphertext[0] ^= 1;
    expect(await alice.read("groq")).toBeUndefined();
    quiet.mockRestore();
  });
});
