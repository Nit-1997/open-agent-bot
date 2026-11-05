import { describe, expect, it } from "vitest";
import { createUsageRepo, UsageRepoError } from "../../src/limits/usageRepo.js";
import type { Db } from "../../src/store/client.js";

const hanging = { rpc: () => ({ abortSignal: () => new Promise(() => {}) }) } as unknown as Db;

describe("usage repo timeout", () => {
  it("rejects with a timeout even when the database call ignores the abort signal", async () => {
    const repo = createUsageRepo(hanging, { caps: { perMonth: 5, perHour: 5 }, timeoutMs: 30 });
    const err = await repo.admit("u").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageRepoError);
    expect(err).toMatchObject({ code: "timeout" });
  });
});
