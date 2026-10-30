import { describe, expect, it } from "vitest";
import { abortableSleep, backoffMs, retryAfterMs, withRetry } from "../../src/lib/retry.js";

const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "{}", { status, headers });

function scripted(steps: Array<number | Error>) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return res(step);
  }) as typeof fetch;
  return { f, calls };
}

function harness(steps: Array<number | Error>, extra: Parameters<typeof withRetry>[1] = {}) {
  const { f, calls } = scripted(steps);
  const waits: number[] = [];
  const wrapped = withRetry(f, { sleep: async (ms) => void waits.push(ms), random: () => 1, log: () => {}, ...extra });
  return { wrapped, calls, waits };
}

describe("withRetry", () => {
  it("retries a 429 and returns the later success", async () => {
    const { wrapped, calls, waits } = harness([429, 200]);
    expect((await wrapped("https://api.example/x")).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([400]);
  });

  it("backs off exponentially and returns the last response when every attempt fails", async () => {
    const { wrapped, calls, waits } = harness([503], { attempts: 4 });
    expect((await wrapped("https://api.example/x")).status).toBe(503);
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([400, 800, 1600]);
  });

  it("does not retry a status that will not change", async () => {
    const { wrapped, calls } = harness([404]);
    expect((await wrapped("https://api.example/x")).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("retries a network error and rethrows it after the last attempt", async () => {
    const { wrapped, calls } = harness([new TypeError("fetch failed")]);
    await expect(wrapped("https://api.example/x")).rejects.toThrow("fetch failed");
    expect(calls).toHaveLength(4);
  });

  it("never retries an aborted or timed-out request", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { wrapped, calls } = harness([abort, 200]);
    await expect(wrapped("https://api.example/x")).rejects.toThrow("aborted");
    expect(calls).toHaveLength(1);
  });

  it("stops waiting as soon as the caller aborts", async () => {
    const controller = new AbortController();
    const { f, calls } = scripted([429, 200]);
    const wrapped = withRetry(f, { sleep: abortableSleep, log: () => {}, baseMs: 60_000, maxDelayMs: 60_000, random: () => 1 });
    const pending = wrapped("https://api.example/x", { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("user cancelled")), 10);
    await expect(pending).rejects.toThrow("user cancelled");
    expect(calls).toHaveLength(1);
  });

  it("only retries reads", async () => {
    const { wrapped, calls } = harness([503, 200]);
    expect((await wrapped("https://api.example/x", { method: "POST" })).status).toBe(503);
    expect(calls).toHaveLength(1);
  });

  it("follows Retry-After but never waits longer than the cap", async () => {
    let n = 0;
    const waits: number[] = [];
    const f = (async () => (n++ === 0 ? res(429, { "retry-after": "120" }) : res(200))) as typeof fetch;
    const wrapped = withRetry(f, { sleep: async (ms) => void waits.push(ms), log: () => {} });
    expect((await wrapped("https://api.example/x")).status).toBe(200);
    expect(waits).toEqual([4000]);
  });
});

describe("retry timing helpers", () => {
  it("reads Retry-After as seconds or an HTTP date", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs("soon")).toBeUndefined();
    expect(retryAfterMs(null)).toBeUndefined();
  });

  it("waits between half and all of an exponentially growing, capped window", () => {
    const o = { baseMs: 400, maxDelayMs: 4000 };
    expect(backoffMs(0, { ...o, random: () => 1 })).toBe(400);
    expect(backoffMs(3, { ...o, random: () => 1 })).toBe(3200);
    expect(backoffMs(10, { ...o, random: () => 1 })).toBe(4000);
    expect(backoffMs(2, { ...o, random: () => 0 })).toBe(800);
  });
});
