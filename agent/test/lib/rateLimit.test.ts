import { describe, expect, it } from "vitest";
import { ConcurrencyGate, RateLimiter } from "../../src/lib/rateLimit.js";

describe("RateLimiter", () => {
  it("allows max hits per sliding window and reports when to retry", () => {
    let now = 0;
    const rl = new RateLimiter({ now: () => now });
    const limit = { max: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      now += 1000;
      expect(rl.take("k", limit)).toEqual({ ok: true });
    }
    expect(rl.take("k", limit)).toEqual({ ok: false, retryAfter: 58 });
    expect(rl.take("other", limit).ok).toBe(true);
    now = 61_001;
    expect(rl.take("k", limit).ok).toBe(true);
  });

  it("forgets keys whose hits have all expired", () => {
    let now = 0;
    const rl = new RateLimiter({ now: () => now });
    rl.take("k", { max: 1, windowMs: 1000 });
    now = 2 * 60 * 60_000;
    rl.sweep();
    expect((rl as unknown as { hits: Map<string, unknown> }).hits.size).toBe(0);
  });
});

describe("ConcurrencyGate", () => {
  it("lets max holders in per key and frees a slot once, even if released twice", () => {
    const gate = new ConcurrencyGate(2);
    const a = gate.enter("u")!;
    const b = gate.enter("u")!;
    expect(gate.enter("u")).toBeUndefined();
    expect(gate.enter("v")).toBeDefined();
    a();
    a();
    expect(gate.enter("u")).toBeDefined();
    expect(gate.enter("u")).toBeUndefined();
    b();
  });
});
