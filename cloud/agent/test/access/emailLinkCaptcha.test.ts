import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundQueue } from "@oab/core/lib/backgroundQueue.js";
import { UserError } from "@oab/core/lib/errors.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { type AccessDeps, createAccessService, type EmailLinkCaptcha } from "../../src/access/service.js";
import type { HumanVerifier, VerifyOutcome } from "../../src/captcha/turnstile.js";
import { makeHostedApp } from "../fixtures/hostedApp.js";

afterEach(() => vi.restoreAllMocks());

function verifier(outcome: VerifyOutcome) {
  const calls: Array<{ token: unknown; action: string; remoteIp?: string }> = [];
  const v: HumanVerifier & { calls: typeof calls } = {
    calls,
    async verify(token, opts) {
      calls.push({ token, ...opts });
      return outcome;
    },
  };
  return v;
}

function service(captcha?: EmailLinkCaptcha) {
  const queue = new BackgroundQueue({ name: "test", max: 50, concurrency: 2 });
  const sendMagicLink = vi.fn<AccessDeps["sendMagicLink"]>(async () => ({}));
  const svc = createAccessService({
    pepper: Buffer.alloc(32, 3),
    limiter: new RateLimiter(),
    queue,
    submit: async () => "inserted",
    sendMagicLink,
    ...(captcha && { captcha }),
  });
  return { svc, queue, sendMagicLink };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof UserError) return { status: err.kind, code: err.code };
    throw err;
  }
  return undefined;
};

describe("email-link captcha", () => {
  it("verifies the token as email_link with the client IP before sending when the check applies", async () => {
    const v = verifier("ok");
    const { svc, queue, sendMagicLink } = service({ required: async () => true, verifier: v });
    await svc.emailLink("a@example.test", "203.0.113.7", "tok");
    await queue.idle();
    expect(v.calls).toEqual([{ token: "tok", action: "email_link", remoteIp: "203.0.113.7" }]);
    expect(sendMagicLink).toHaveBeenCalledWith("a@example.test");
  });

  it("refuses a failed or missing token with human_check_failed and sends nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { svc, queue, sendMagicLink } = service({ required: async () => true, verifier: verifier("failed") });
    expect(await refusal(svc.emailLink("a@example.test", "203.0.113.7", undefined))).toEqual({
      status: "forbidden",
      code: "human_check_failed",
    });
    await queue.idle();
    expect(sendMagicLink).not.toHaveBeenCalled();
  });

  it("refuses with human_check_unavailable when Cloudflare is down or Turnstile isn't configured", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const captcha of [{ required: async () => true, verifier: verifier("unavailable") }, { required: async () => true }]) {
      const { svc, sendMagicLink } = service(captcha);
      expect(await refusal(svc.emailLink("a@example.test", "1.1.1.1", "tok"))).toEqual({
        status: "unavailable",
        code: "human_check_unavailable",
      });
      expect(sendMagicLink).not.toHaveBeenCalled();
    }
  });

  it("ignores the token when the check doesn't apply", async () => {
    const v = verifier("failed");
    const { svc, queue, sendMagicLink } = service({ required: async () => false, verifier: v });
    await svc.emailLink("a@example.test", "1.1.1.1");
    await queue.idle();
    expect(v.calls).toEqual([]);
    expect(sendMagicLink).toHaveBeenCalledOnce();
  });
});

describe("POST /auth/email-link with the captcha", () => {
  it("passes captchaToken and x-client-ip through and maps refusals to 403 and 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const v = verifier("failed");
    const h = await makeHostedApp({ signupMode: async () => "open", verifier: v });
    const res = await h.call(null, "/auth/email-link", {
      method: "POST",
      body: JSON.stringify({ email: "a@example.test", captchaToken: "tok-9" }),
      headers: { "x-client-ip": "203.0.113.7, 10.0.0.1" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "human_check_failed", message: "We couldn't verify that. Try again." });
    expect(v.calls).toEqual([{ token: "tok-9", action: "email_link", remoteIp: "203.0.113.7" }]);
  });
});
