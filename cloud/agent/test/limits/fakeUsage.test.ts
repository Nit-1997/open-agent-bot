import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UsageRepoError } from "../../src/limits/usageRepo.js";
import { FakeUsageStore, minusMonths } from "./fakeUsage.js";
import { usageContract } from "./usageContract.js";

const store = new FakeUsageStore();

usageContract("in-memory fake", {
  repo: (opts) => store.repo(opts),
  email: (tag) => `oab-m7+${tag}-${randomUUID().slice(0, 8)}@example.test`,
  newUser: async (email) => store.newUser(email),
  deleteUser: async (id) => store.deleteUser(id),
  monthCount: async (id, month) => store.monthCount(id, month),
});

describe("FakeUsageStore extras", () => {
  it("counts repo calls and fails on demand", async () => {
    const s = new FakeUsageStore();
    const { id } = s.newUser();
    const repo = s.repo({ caps: { perMonth: 5, perHour: 5 } });
    await repo.admit(id);
    repo.failWith = new UsageRepoError("admit", "timeout");
    await expect(repo.admit(id)).rejects.toMatchObject({ code: "timeout" });
    expect(repo.calls).toBe(2);
  });

  it("prunes tombstones older than two months", async () => {
    let now = new Date("2031-05-10T00:00:00.000Z");
    const s = new FakeUsageStore(() => now);
    const { id } = s.newUser();
    await s.repo({ caps: { perMonth: 5, perHour: 5 } }).tombstone(id);
    now = new Date("2031-07-10T00:00:00.000Z");
    await s.repo({ caps: { perMonth: 5, perHour: 5 } }).prune();
    expect(s.tombstoneCount()).toBe(0);
  });

  it("subtracts calendar months like Postgres", () => {
    expect(new Date(minusMonths(Date.parse("2031-04-30T10:00:00.000Z"), 2)).toISOString()).toBe("2031-02-28T10:00:00.000Z");
    expect(new Date(minusMonths(Date.parse("2031-01-15T00:00:00.000Z"), 2)).toISOString()).toBe("2030-11-15T00:00:00.000Z");
  });
});
