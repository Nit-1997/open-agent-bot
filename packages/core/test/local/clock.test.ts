import { describe, expect, it } from "vitest";
import { monotonicClock } from "../../src/local/store/clock.js";
import { openWithUser, tempDir } from "./storeHarness.js";

describe("monotonic clock", () => {
  it("is strictly increasing over 1,000 calls with a frozen now", () => {
    const next = monotonicClock(() => 1_800_000_000_000, 0);
    const stamps = Array.from({ length: 1000 }, next);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]! > stamps[i - 1]!).toBe(true);
    expect(stamps.every((s) => new Date(s).toISOString() === s)).toBe(true);
  });

  it("starts after the seed when now is behind it", () => {
    const next = monotonicClock(() => 1_000, Date.parse("2030-01-01T00:00:00.000Z"));
    expect(next()).toBe("2030-01-01T00:00:00.001Z");
    expect(next()).toBe("2030-01-01T00:00:00.002Z");
  });

  it("follows now when now is ahead", () => {
    let t = 5_000;
    const next = monotonicClock(() => t, 1_000);
    expect(next()).toBe(new Date(5_000).toISOString());
    t = 9_000;
    expect(next()).toBe(new Date(9_000).toISOString());
  });

  it("is seeded from the largest stored timestamp when a store reopens with an earlier clock", async () => {
    const tmp = tempDir();
    try {
      const { store, userId } = openWithUser({ dir: tmp.dir });
      const r = store.forUser(userId);
      const old: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = crypto.randomUUID();
        await r.chats.claim(id, {});
        await r.messages.append(id, "run", [{ role: "user", content: `m${i}`, status: "complete" }]);
        await r.chats.touch(id, { titleIfEmpty: `chat ${i}` });
        old.push(id);
      }
      await r.artifacts.insert({ id: "abcdefghijkl", chatId: null, title: "Report", sizeBytes: 10 });
      const stored = [
        ...(await r.chats.page(1)).items.map((c) => c.lastMessageAt),
        ...(await r.artifacts.page(1)).items.map((a) => a.createdAt),
        (await r.providerSettings.get()).stamp,
      ];
      await store.close();

      const reopened = openWithUser({ dir: tmp.dir, now: () => Date.now() - 3_600_000 }).store;
      const again = reopened.forUser(userId);
      const fresh = crypto.randomUUID();
      await again.chats.claim(fresh, {});
      const page = await again.chats.page(1);
      expect(page.items[0]?.id).toBe(fresh);
      const stamp = page.items[0]!.lastMessageAt;
      for (const s of stored) expect(stamp > s).toBe(true);
      const history = await again.messages.history(old[2]!);
      await again.messages.append(old[2]!, "run", [{ role: "user", content: "later", status: "complete" }]);
      const after = await again.messages.history(old[2]!);
      expect(after.items.at(-1)!.createdAt > history.items.at(-1)!.createdAt).toBe(true);
      await reopened.close();
    } finally {
      tmp.dispose();
    }
  });
});
