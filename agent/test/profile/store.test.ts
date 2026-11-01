import { describe, expect, it } from "vitest";
import { emptyProfile } from "../../../shared/profile.js";
import { SupabaseProfileStore } from "../../src/profile/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE, BOB } from "../fixtures/users.js";

describe("SupabaseProfileStore", () => {
  it("starts empty, keeps what was saved and keeps users apart", async () => {
    const db = new MemoryDb();
    const alice = new SupabaseProfileStore(db.forUser(ALICE.id).profiles);
    expect(await alice.get()).toEqual(emptyProfile());
    await alice.put({ name: "Nitin", defaultModel: "openrouter/x/y" });
    expect(await new SupabaseProfileStore(db.forUser(ALICE.id).profiles).get()).toMatchObject({
      name: "Nitin",
      defaultModel: "openrouter/x/y",
    });
    expect((await new SupabaseProfileStore(db.forUser(BOB.id).profiles).get()).name).toBeUndefined();
  });

  it("refuses an invalid profile and keeps the previous one", async () => {
    const store = new SupabaseProfileStore(new MemoryDb().forUser(ALICE.id).profiles);
    await store.put({ name: "A" });
    await expect(store.put({ travel: { style: "first-class" } })).rejects.toThrow(/isn't valid/);
    expect((await store.get()).name).toBe("A");
  });

  it("treats stored data that no longer validates as empty", async () => {
    const db = new MemoryDb();
    await db.forUser(ALICE.id).profiles.putData({ skipped: ["bogus"] });
    expect(await new SupabaseProfileStore(db.forUser(ALICE.id).profiles).get()).toEqual(emptyProfile());
  });
});
