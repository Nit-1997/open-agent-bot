import { describe, expect, it, vi } from "vitest";
import { type AccessDeps, createAccessService, hashIp, normalizeEmail, readRequest } from "../../../src/hosted/access/service.js";
import { BackgroundQueue } from "../../../src/lib/backgroundQueue.js";
import { RateLimiter } from "../../../src/lib/rateLimit.js";

const pepper = Buffer.alloc(32, 3);
const form = (n = 0) => ({ name: "A", email: "a@example.test", note: "", formToken: `token-${n}` });

function service(over: Partial<AccessDeps> = {}) {
  const queue = new BackgroundQueue({ name: "test", max: 50, concurrency: 2 });
  const deps = {
    pepper,
    limiter: new RateLimiter(),
    queue,
    submit: vi.fn<AccessDeps["submit"]>(async () => "inserted"),
    sendMagicLink: vi.fn<AccessDeps["sendMagicLink"]>(async () => ({})),
  };
  return { svc: createAccessService({ ...deps, ...over }), queue, deps };
}

describe("access service", () => {
  it("hashes IPs with the pepper and never passes the raw IP on", async () => {
    const { svc, queue, deps } = service();
    svc.request(form(), "198.51.100.9");
    await queue.idle();
    const arg = deps.submit.mock.calls[0][0];
    expect(arg.ipHash.equals(hashIp(pepper, "198.51.100.9"))).toBe(true);
    expect(JSON.stringify(deps.submit.mock.calls)).not.toContain("198.51.100.9");
    expect(JSON.stringify(deps.submit.mock.calls)).not.toContain("token-0");
  });

  it("keys IPv6 addresses by their /64 so rotating inside a prefix doesn't escape limits", () => {
    expect(hashIp(pepper, "2001:4860:1:2::1").equals(hashIp(pepper, "2001:4860:1:2:ffff::9"))).toBe(true);
    expect(hashIp(pepper, "2001:4860:1:2::1").equals(hashIp(pepper, "2001:4860:1:3::1"))).toBe(false);
    expect(hashIp(pepper, "::ffff:198.51.100.9").equals(hashIp(pepper, "198.51.100.9"))).toBe(true);
  });

  it("returns before any outcome-dependent work and swallows every outcome", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const outcome of ["duplicate", "already_member", "rate_limited_ip"] as const) {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const { svc, queue } = service({
        submit: vi.fn(async () => {
          await gate;
          return outcome;
        }),
      });
      expect(svc.request(form(), "1.2.3.4")).toBeUndefined();
      release();
      await queue.idle();
    }
    const failing = service({ submit: vi.fn(async () => Promise.reject(new Error("db"))) });
    expect(failing.svc.request(form(), "1.2.3.4")).toBeUndefined();
    await failing.queue.idle();
    quiet.mockRestore();
  });

  it("accepts each form token once", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { svc, queue, deps } = service();
    svc.request(form(1), "1.2.3.4");
    svc.request(form(1), "1.2.3.4");
    svc.request(form(2), "1.2.3.4");
    await queue.idle();
    expect(deps.submit).toHaveBeenCalledTimes(2);
    quiet.mockRestore();
  });

  it("sends at most 5 links per IP and 3 per address and IP an hour, so other IPs can't lock a person out", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { svc, queue, deps } = service();
    for (let i = 0; i < 4; i++) svc.emailLink("victim@example.test", "1.1.1.1");
    await queue.idle();
    expect(deps.sendMagicLink).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 4; i++) svc.emailLink(`x${i}@example.test`, "1.1.1.1");
    await queue.idle();
    expect(deps.sendMagicLink).toHaveBeenCalledTimes(4);
    svc.emailLink("victim@example.test", "8.8.8.8");
    await queue.idle();
    expect(deps.sendMagicLink).toHaveBeenCalledTimes(5);
    quiet.mockRestore();
  });

  it("logs send failures without the address", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const { svc, queue } = service({ sendMagicLink: vi.fn(async () => Promise.reject(new Error("smtp down for victim@example.test"))) });
    svc.emailLink("victim@example.test", "1.1.1.1");
    await queue.idle();
    expect(JSON.stringify(info.mock.calls)).toContain("code=unreachable");
    expect(JSON.stringify(info.mock.calls)).not.toContain("victim@example.test");
    info.mockRestore();
  });

  it("validates names, notes, emails and the form token", () => {
    expect(normalizeEmail(" A@Example.TEST ")).toBe("a@example.test");
    expect(() => normalizeEmail("nope")).toThrow();
    expect(() => readRequest({ name: "", email: "a@b.co", formToken: "t" })).toThrow(/name/);
    expect(() => readRequest({ name: "A", email: "a@b.co", note: "x".repeat(1001), formToken: "t" })).toThrow(/note/);
    expect(() => readRequest({ name: "A", email: "a@b.co" })).toThrow(/form expired/);
    expect(readRequest({ name: " A ", email: "A@B.co", note: " hi ", formToken: "t" })).toEqual({
      name: "A",
      email: "a@b.co",
      note: "hi",
      formToken: "t",
    });
  });
});
