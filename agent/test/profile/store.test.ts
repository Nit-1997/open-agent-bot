import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyProfile } from "../../../shared/profile.js";
import { FileProfileStore } from "../../src/profile/store.js";

describe("FileProfileStore", () => {
  it("starts empty, then keeps what was saved across restarts in an owner-only file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "profile-"));
    expect(await FileProfileStore.at(dir).get()).toEqual(emptyProfile());
    await FileProfileStore.at(dir).put({ name: "Nitin", defaultModel: "openrouter/x/y" });
    const again = FileProfileStore.at(dir);
    expect(await again.get()).toMatchObject({ name: "Nitin", defaultModel: "openrouter/x/y" });
    expect((await stat(join(dir, "profile.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(dir, "profile.json"), "utf8")).name).toBe("Nitin");
  });

  it("refuses an invalid profile and keeps the previous one", async () => {
    const store = FileProfileStore.at(await mkdtemp(join(tmpdir(), "profile-")));
    await store.put({ name: "A" });
    await expect(store.put({ travel: { style: "first-class" } })).rejects.toThrow(/isn't valid/);
    expect((await store.get()).name).toBe("A");
  });

  it("treats a stored file that no longer validates as empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "profile-"));
    await writeFile(join(dir, "profile.json"), JSON.stringify({ skipped: ["bogus"] }));
    expect(await FileProfileStore.at(dir).get()).toEqual(emptyProfile());
  });

  it("returns copies, so callers can't change the stored profile by accident", async () => {
    const store = FileProfileStore.at(await mkdtemp(join(tmpdir(), "profile-")));
    (await store.get()).food.push("x");
    expect((await store.get()).food).toEqual([]);
  });
});
