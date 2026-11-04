import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnstileVerifier, isTestSecret, TEST_SITE_KEY_RE, TOKEN_MAX, TURNSTILE_VERIFY_URL } from "../../src/captcha/turnstile.js";
import { passing, type SiteVerifyStub, startSiteVerify } from "../fixtures/siteverify.js";

const SECRET = "0x4AAAAAAAsentinelSecretValue_123";
const TOKEN = "sentinel-token-1b2c3d";
const PASS_SECRET = "1x0000000000000000000000000000000AA";
const FAIL_SECRET = "2x0000000000000000000000000000000AA";
const PASS_SITE_KEY = "1x00000000000000000000AA";
const FAIL_SITE_KEY = "2x00000000000000000000AB";
const RECORDED_TEST_PASS = {
  challenge_ts: "2026-11-04T11:36:03.573Z",
  "error-codes": [],
  hostname: "example.com",
  metadata: { result_with_testing_key: true },
  success: true,
};

let stub: SiteVerifyStub;
let logs: string[];

beforeEach(async () => {
  stub = await startSiteVerify();
  logs = [];
  for (const level of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await stub.close();
});

const verifier = (over: Partial<Parameters<typeof createTurnstileVerifier>[0]> = {}) =>
  createTurnstileVerifier({ secret: SECRET, hostname: "app.localhost", verifyUrl: stub.url, ...over });

describe("Turnstile verification against a stub siteverify", () => {
  it("passes a token whose success, hostname and action all match, and posts the secret, token and client IP as a form", async () => {
    expect(await verifier().verify(TOKEN, { action: "human_check", remoteIp: "203.0.113.7" })).toBe("ok");
    expect(stub.requests).toEqual([
      { secret: SECRET, response: TOKEN, remoteip: "203.0.113.7", contentType: "application/x-www-form-urlencoded" },
    ]);
  });

  it("fails success:false with the error codes in the log", async () => {
    stub.reply = () => ({ body: { success: false, "error-codes": ["invalid-input-response"] } });
    expect(await verifier().verify(TOKEN, { action: "human_check" })).toBe("failed");
    expect(logs.join("\n")).toContain("codes=invalid-input-response");
  });

  it("fails a reused token (Cloudflare answers timeout-or-duplicate)", async () => {
    const v = verifier();
    expect(await v.verify(TOKEN, { action: "human_check" })).toBe("ok");
    expect(await v.verify(TOKEN, { action: "human_check" })).toBe("failed");
    expect(logs.join("\n")).toContain("codes=timeout-or-duplicate");
  });

  it("fails a hostname that isn't APP_ORIGIN's hostname, including one with a port", async () => {
    stub.reply = () => ({ body: passing({ hostname: "evil.example" }) });
    expect(await verifier().verify(TOKEN, { action: "human_check" })).toBe("failed");
    stub.reply = () => ({ body: passing({ hostname: "app.localhost:443" }) });
    expect(await verifier().verify(TOKEN, { action: "human_check" })).toBe("failed");
    expect(logs.join("\n")).toContain("reason=hostname");
  });

  it("fails a token issued for the other action (email_link vs human_check) or without one", async () => {
    stub.reply = () => ({ body: passing({ action: "email_link" }) });
    expect(await verifier().verify(TOKEN, { action: "human_check" })).toBe("failed");
    stub.reply = () => ({ body: passing({ action: "human_check" }) });
    expect(await verifier().verify(TOKEN, { action: "email_link" })).toBe("failed");
    stub.reply = () => ({ body: passing({ action: undefined }) });
    expect(await verifier().verify(TOKEN, { action: "human_check" })).toBe("failed");
    expect(logs.join("\n")).toContain("reason=action");
  });

  it("answers unavailable on a timeout, a 5xx, a non-JSON answer or an unreachable server", async () => {
    stub.reply = () => ({ body: passing(), delayMs: 500 });
    expect(await verifier({ timeoutMs: 50 }).verify(TOKEN, { action: "human_check" })).toBe("unavailable");
    stub.reply = () => ({ status: 502, body: {} });
    expect(await verifier().verify(TOKEN, { action: "human_check" })).toBe("unavailable");
    stub.reply = () => ({ raw: "<html>oops</html>" });
    expect(await verifier().verify(TOKEN, { action: "human_check" })).toBe("unavailable");
    expect(await verifier({ verifyUrl: "http://127.0.0.1:9/siteverify" }).verify(TOKEN, { action: "human_check" })).toBe("unavailable");
  });

  it("times out after 5 s by default", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const spy = vi.spyOn(AbortSignal, "timeout");
      await verifier({ fetch: async () => new Response(JSON.stringify(passing())) }).verify(TOKEN, { action: "human_check" });
      expect(spy).toHaveBeenCalledWith(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a missing, empty, non-string or oversized token without calling Cloudflare", async () => {
    for (const bad of [undefined, "", 42, { token: TOKEN }, "x".repeat(TOKEN_MAX + 1)])
      expect(await verifier().verify(bad, { action: "human_check" })).toBe("failed");
    expect(stub.requests).toEqual([]);
  });

  it("drops a remote IP that isn't an address", async () => {
    await verifier().verify(TOKEN, { action: "human_check", remoteIp: "unknown" });
    expect(stub.requests[0]?.remoteip).toBeNull();
  });

  it("never logs the token or the secret", async () => {
    const v = verifier();
    stub.reply = () => ({ body: { success: false, "error-codes": ["invalid-input-secret"] } });
    await v.verify(TOKEN, { action: "human_check" });
    stub.reply = () => ({ body: passing({ hostname: "x.example" }) });
    await v.verify(TOKEN, { action: "email_link" });
    stub.reply = () => ({ status: 500 });
    await v.verify(TOKEN, { action: "human_check" });
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(SECRET);
    }
  });

  it("uses Cloudflare's endpoint by default", () => {
    expect(TURNSTILE_VERIFY_URL).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  });
});

describe("the recorded test-key response (hostname example.com, no action)", () => {
  it("passes only with a test secret and allowTestResponse (local-stack mode)", async () => {
    stub.reply = () => ({ body: RECORDED_TEST_PASS });
    expect(await verifier({ secret: PASS_SECRET, allowTestResponse: true }).verify(TOKEN, { action: "human_check" })).toBe("ok");
    expect(await verifier({ secret: PASS_SECRET, allowTestResponse: true }).verify(TOKEN, { action: "email_link" })).toBe("ok");
  });

  it("fails with a real secret even when allowTestResponse is set, and with a test secret when it isn't", async () => {
    stub.reply = () => ({ body: RECORDED_TEST_PASS });
    expect(await verifier({ allowTestResponse: true }).verify(TOKEN, { action: "human_check" })).toBe("failed");
    expect(await verifier({ secret: PASS_SECRET }).verify(TOKEN, { action: "human_check" })).toBe("failed");
  });

  it("fails a test-key response that names a hostname or an action, or lacks the testing marker", async () => {
    const v = verifier({ secret: PASS_SECRET, allowTestResponse: true });
    for (const body of [
      { ...RECORDED_TEST_PASS, hostname: "evil.example" },
      { ...RECORDED_TEST_PASS, action: "email_link" },
      { ...RECORDED_TEST_PASS, metadata: {} },
      { ...RECORDED_TEST_PASS, success: false },
    ]) {
      stub.reply = () => ({ body });
      expect(await v.verify(TOKEN, { action: "human_check" })).toBe("failed");
    }
  });
});

describe("Cloudflare test keys", () => {
  it("recognises the dummy secrets and site keys and nothing else", () => {
    for (const s of [PASS_SECRET, FAIL_SECRET, "3x0000000000000000000000000000000AA", "2x0000000000000000000000000000000BB"])
      expect(isTestSecret(s)).toBe(true);
    for (const s of [SECRET, "1x00000000000000000000000000000AA", "0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"])
      expect(isTestSecret(s)).toBe(false);
    for (const k of [PASS_SITE_KEY, FAIL_SITE_KEY, "3x00000000000000000000FF"]) expect(TEST_SITE_KEY_RE.test(k)).toBe(true);
    for (const k of ["0x4AAAAAAAB5rGc7r3b0Ifk0", "1x0000000000000000000AA"]) expect(TEST_SITE_KEY_RE.test(k)).toBe(false);
  });
});

describe.skipIf(process.env.OAB_NETWORK_TESTS !== "1")("Cloudflare siteverify with the dummy secrets (network)", () => {
  it("passes with the always-pass secret through the recorded-response exception, and fails with the always-fail secret", async () => {
    const pass = createTurnstileVerifier({ secret: PASS_SECRET, hostname: "localhost", allowTestResponse: true });
    expect(await pass.verify("XXXX.DUMMY.TOKEN.XXXX", { action: "human_check" })).toBe("ok");
    const strict = createTurnstileVerifier({ secret: PASS_SECRET, hostname: "localhost" });
    expect(await strict.verify("XXXX.DUMMY.TOKEN.XXXX", { action: "human_check" })).toBe("failed");
    const fail = createTurnstileVerifier({ secret: FAIL_SECRET, hostname: "localhost", allowTestResponse: true });
    expect(await fail.verify("XXXX.DUMMY.TOKEN.XXXX", { action: "human_check" })).toBe("failed");
  });
});
