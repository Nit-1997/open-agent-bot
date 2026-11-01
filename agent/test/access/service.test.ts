import { describe, expect, it, vi } from "vitest";
import { createAccessService, hashIp, normalizeEmail, padTo, readRequest } from "../../src/access/service.js";
import { RateLimiter } from "../../src/lib/rateLimit.js";

const pepper = Buffer.alloc(32, 3);

describe("access service", () => {
  it("hashes IPs with the pepper and never stores the raw IP", async () => {
    const submit = vi.fn(async () => "inserted" as const);
    const svc = createAccessService({ pepper, limiter: new RateLimiter(), submit, sendMagicLink: async () => ({}) });
    await svc.request({ name: "A", email: "a@example.test", note: "" }, "203.0.113.9");
    const arg = (submit.mock.calls[0] as unknown as [{ ipHash: Buffer }])[0];
    expect(arg.ipHash.equals(hashIp(pepper, "203.0.113.9"))).toBe(true);
    expect(JSON.stringify(submit.mock.calls)).not.toContain("203.0.113.9");
  });

  it("swallows every outcome so callers can't tell members, duplicates or limits apart", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const outcome of ["duplicate", "already_member", "rate_limited_ip"] as const) {
      const svc = createAccessService({ pepper, limiter: new RateLimiter(), submit: async () => outcome, sendMagicLink: async () => ({}) });
      await expect(svc.request({ name: "A", email: "a@example.test", note: "" }, "1.2.3.4")).resolves.toBeUndefined();
    }
    const failing = createAccessService({
      pepper,
      limiter: new RateLimiter(),
      submit: async () => Promise.reject(new Error("db")),
      sendMagicLink: async () => ({}),
    });
    await expect(failing.request({ name: "A", email: "a@example.test", note: "" }, "1.2.3.4")).resolves.toBeUndefined();
    quiet.mockRestore();
  });

  it("sends at most 5 email links per IP and 3 per address an hour, silently", async () => {
    const send = vi.fn(async () => ({}));
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc = createAccessService({ pepper, limiter: new RateLimiter(), submit: async () => "inserted", sendMagicLink: send });
    for (let i = 0; i < 4; i++) await svc.emailLink("same@example.test", "1.1.1.1");
    expect(send).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 4; i++) await svc.emailLink(`x${i}@example.test`, "1.1.1.1");
    expect(send).toHaveBeenCalledTimes(4);
    quiet.mockRestore();
  });

  it("pads responses to a floor", async () => {
    let now = 0;
    const sleep = vi.spyOn(globalThis, "setTimeout");
    await padTo(
      300,
      async () => {
        now = 100;
      },
      () => now,
    );
    expect(sleep.mock.calls.at(-1)?.[1]).toBe(200);
  });

  it("validates names, notes and emails", () => {
    expect(normalizeEmail(" A@Example.TEST ")).toBe("a@example.test");
    expect(() => normalizeEmail("nope")).toThrow();
    expect(() => readRequest({ name: "", email: "a@b.co" })).toThrow(/name/);
    expect(() => readRequest({ name: "A", email: "a@b.co", note: "x".repeat(1001) })).toThrow(/note/);
    expect(readRequest({ name: " A ", email: "A@B.co", note: " hi " })).toEqual({ name: "A", email: "a@b.co", note: "hi" });
  });
});
