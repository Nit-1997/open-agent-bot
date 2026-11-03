import { describe, expect, it, vi } from "vitest";
import { UserStatusCache } from "../../src/hosted/identity/status.js";

describe("UserStatusCache", () => {
  it("caches both answers for 30 s and refreshes after an invalidate", async () => {
    let now = 0;
    let status: "active" | "deactivated" | undefined = "active";
    const lookup = vi.fn(async () => status);
    const cache = new UserStatusCache(lookup, { now: () => now });
    expect(await cache.isActive("u")).toBe(true);
    status = "deactivated";
    expect(await cache.isActive("u")).toBe(true);
    now = 30_001;
    expect(await cache.isActive("u")).toBe(false);
    status = "active";
    cache.invalidate("u");
    expect(await cache.isActive("u")).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("treats a missing profile as not active and never assumes active on failure", async () => {
    expect(await new UserStatusCache(async () => undefined).isActive("u")).toBe(false);
    await expect(new UserStatusCache(async () => Promise.reject(new Error("down"))).isActive("u")).rejects.toThrow("down");
  });
});
