import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignupMode } from "@oab/shared/usage";
import type { HumanVerifier, VerifyOutcome } from "../../src/captcha/turnstile.js";
import { UsageRepoError } from "../../src/limits/usageRepo.js";
import { makeHostedApp } from "../fixtures/hostedApp.js";
import { ALICE, BOB } from "../fixtures/users.js";

afterEach(() => vi.restoreAllMocks());

function fakeVerifier(outcome: VerifyOutcome = "ok") {
  const calls: Array<{ token: unknown; action: string; remoteIp?: string }> = [];
  const v: HumanVerifier & { calls: typeof calls; outcome: VerifyOutcome } = {
    calls,
    outcome,
    async verify(token, opts) {
      calls.push({ token, ...opts });
      return v.outcome;
    },
  };
  return v;
}

async function app(mode: SignupMode | "unknown" = "open", verifier: HumanVerifier | null = fakeVerifier()) {
  const h = await makeHostedApp({ signupMode: async () => mode, ...(verifier && { verifier }) });
  for (const u of [ALICE, BOB]) h.usage.store.newUser(u.email, u.id);
  return h;
}

const post = (h: Awaited<ReturnType<typeof app>>, user = ALICE, b: unknown = { token: "tok-1" }, headers: Record<string, string> = {}) =>
  h.call(user, "/human-check", { method: "POST", body: JSON.stringify(b), headers });

describe("POST /human-check", () => {
  it("verifies the token as human_check with the forwarded client IP, stores the check for the session user and answers done", async () => {
    const v = fakeVerifier();
    const h = await app("open", v);
    expect(await h.gate.state(ALICE.id)).toBe("required");
    const res = await post(h, ALICE, { token: "tok-1", userId: BOB.id }, { "x-client-ip": "203.0.113.7" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ humanCheck: "done" });
    expect(v.calls).toEqual([{ token: "tok-1", action: "human_check", remoteIp: "203.0.113.7" }]);
    expect(await h.usage.usage.humanCheck.get(ALICE.id)).toBe(true);
    expect(await h.usage.usage.humanCheck.get(BOB.id)).toBe(false);
    expect(await h.gate.state(ALICE.id)).toBe("done");
  });

  it("is a no-op answering done when the check already exists (no token needed, no verification)", async () => {
    const v = fakeVerifier();
    const h = await app("open", v);
    await h.usage.usage.humanCheck.set(ALICE.id);
    const res = await post(h, ALICE, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ humanCheck: "done" });
    expect(v.calls).toEqual([]);
  });

  it("answers off without verifying in waitlist and invite", async () => {
    for (const mode of ["waitlist", "invite"] as const) {
      const v = fakeVerifier();
      const res = await post(await app(mode, v));
      expect(await res.json()).toEqual({ humanCheck: "off" });
      expect(v.calls).toEqual([]);
    }
  });

  it("requires the check when the mode is unknown", async () => {
    const v = fakeVerifier();
    const h = await app("unknown", v);
    expect(await (await post(h)).json()).toEqual({ humanCheck: "done" });
    expect(v.calls).toHaveLength(1);
  });

  it("refuses a failed verification with 403 human_check_failed and stores nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = await app("open", fakeVerifier("failed"));
    const res = await post(h);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "human_check_failed", message: "We couldn't verify that. Try again." });
    expect(await h.usage.usage.humanCheck.get(ALICE.id)).toBe(false);
  });

  it("answers 503 human_check_unavailable when Cloudflare is unreachable, without Turnstile, or when the check can't be read or saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unavailable = { error: "human_check_unavailable", message: "Sign-up checks are unavailable right now. Try again in a minute." };
    const down = await post(await app("open", fakeVerifier("unavailable")));
    expect(down.status).toBe(503);
    expect(down.headers.get("retry-after")).toBe("60");
    expect(await down.json()).toMatchObject(unavailable);

    const none = await post(await app("open", null));
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject(unavailable);

    const lookup = await app("open");
    lookup.usage.usage.failWith = new UsageRepoError("humanCheck.get", "timeout");
    expect((await post(lookup)).status).toBe(503);

    const saving = await app("open");
    const set = vi.spyOn(saving.usage.usage.humanCheck, "set").mockRejectedValue(new UsageRepoError("humanCheck.set", "timeout"));
    expect((await post(saving)).status).toBe(503);
    expect(set).toHaveBeenCalledWith(ALICE.id);
    expect(await saving.gate.state(ALICE.id)).toBe("required");
  });

  it("allows 10 attempts per 10 minutes per user", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = await app("open", fakeVerifier("failed"));
    for (let i = 0; i < 10; i++) expect((await post(h)).status).toBe(403);
    const limited = await post(h);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    expect((await post(h, BOB)).status).toBe(403);
  });

  it("is signed-in only", async () => {
    const h = await app();
    const res = await h.call(null, "/human-check", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});

describe("GET /signup", () => {
  it("answers the mode and whether email links need the captcha: waitlist with the captcha when the mode is unknown", async () => {
    for (const [mode, shown, captcha] of [
      ["open", "open", true],
      ["invite", "invite", false],
      ["waitlist", "waitlist", false],
      ["unknown", "waitlist", true],
    ] as const) {
      const res = await (await app(mode)).call(null, "/signup");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ mode: shown, captcha });
    }
  });

  it("needs the service secret", async () => {
    expect((await (await app()).call(null, "/signup", { secret: null })).status).toBe(401);
  });
});

describe("GET /usage humanCheck", () => {
  it("reports required, then done after the check", async () => {
    const h = await app("open");
    expect(await (await h.call(ALICE, "/usage")).json()).toMatchObject({ humanCheck: "required" });
    await post(h);
    expect(await (await h.call(ALICE, "/usage")).json()).toMatchObject({ humanCheck: "done" });
  });
});
