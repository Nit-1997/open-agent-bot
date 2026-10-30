import { describe, expect, it } from "vitest";
import { type Judge, judgeResolver, noJudge } from "../../src/judge/index.js";

const live = { ...noJudge, available: true } as Judge;

describe("judgeResolver", () => {
  it("retries an unavailable judge after the retry window and then keeps the available one", async () => {
    let now = 0;
    let calls = 0;
    const results = [noJudge, live];
    const resolve = judgeResolver(async () => results[calls++] ?? live, { retryMs: 1000, now: () => now, log: () => {} });
    expect((await resolve()).available).toBe(false);
    now = 500;
    expect((await resolve()).available).toBe(false);
    expect(calls).toBe(1);
    now = 1500;
    expect(await resolve()).toBe(live);
    now = 99_000;
    expect(await resolve()).toBe(live);
    expect(calls).toBe(2);
  });

  it("treats a failing lookup as unavailable and shares one lookup between concurrent callers", async () => {
    let calls = 0;
    const resolve = judgeResolver(
      async () => {
        calls++;
        throw new Error("network");
      },
      { log: () => {} },
    );
    const [a, b] = await Promise.all([resolve(), resolve()]);
    expect(a).toBe(noJudge);
    expect(b).toBe(noJudge);
    expect(calls).toBe(1);
  });
});
