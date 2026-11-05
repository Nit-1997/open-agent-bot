import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AuthEnv } from "@oab/core/identity/types.js";
import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { HumanVerifier } from "../../src/captcha/turnstile.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import { RunSlots } from "../../src/limits/slots.js";
import { createUsageRepo } from "../../src/limits/usageRepo.js";
import { LiveHumanCheckGate } from "../../src/signup/humanCheck.js";
import { humanCheckRoutes } from "../../src/signup/routes.js";
import { createSignupSettings } from "../../src/signup/settings.js";
import { createServiceClient } from "../../src/store/client.js";
import { cleanup, closeHarness, createUser, localEnv, sql } from "./harness.js";

const db = () => createServiceClient({ supabaseUrl: localEnv().apiUrl, supabaseSecretKey: localEnv().secretKey });
const repo = () => createUsageRepo(db(), { caps: { perMonth: 100, perHour: 100 } });
const LIMITS = { runningPerUser: 1, perHour: 100, perMonth: 100, runningServer: 8 };

async function reloadUntil<T>(probe: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  await sql("notify pgrst, 'reload schema'");
  for (let i = 0; i < 100; i++) {
    const v = await probe();
    if (done(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("PostgREST did not pick up the schema change");
}

const setMode = (mode: string) => sql("update public.signup_settings set mode = $1 where id", [mode]);

afterEach(async () => {
  vi.restoreAllMocks();
  await setMode("waitlist");
});

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

describe("signup settings and the human-check gate on the local stack", () => {
  it("reads the mode and the signup stats through the service-role RPCs", async () => {
    expect(await createSignupSettings(db()).mode()).toBe("waitlist");
    await setMode("open");
    expect(await createSignupSettings(db()).mode()).toBe("open");
    expect(await createSignupSettings(db()).stats()).toMatchObject({ capHour: 20, capDay: 100 });
  });

  it("still requires the check when the mode lookup is broken (execute revoked), and the run is refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = await createUser({ invited: false });
    const usage = repo();
    try {
      await sql("revoke execute on function public.signup_settings_get() from service_role");
      const settings = createSignupSettings(db());
      expect(
        await reloadUntil(
          () => createSignupSettings(db()).mode(),
          (m) => m === "unknown",
        ),
      ).toBe("unknown");
      const gate = new LiveHumanCheckGate({ mode: () => settings.mode(), checks: usage.humanCheck, verifierConfigured: true });
      expect(await gate.state(user.id)).toBe("required");
      const policy = new HostedRunPolicy({
        limits: LIMITS,
        usage,
        slots: new RunSlots({ staleAfterMs: 340_000 }),
        humanCheck: gate,
        limiter: new RateLimiter(),
      });
      const principal: Principal = { ...user, capabilities: NO_CAPABILITIES };
      const refused = await policy.admit({ principal, chatId: randomUUID(), runId: "r1" });
      expect(refused.ok ? "ok" : refused.error.opts.code).toBe("human_check_required");
      expect(await sql("select 1 from public.request_usage where user_id = $1 and count > 0", [user.id])).toEqual([]);
    } finally {
      await sql("grant execute on function public.signup_settings_get() to service_role");
      await reloadUntil(
        () => createSignupSettings(db()).mode(),
        (m) => m !== "unknown",
      );
    }
  });

  it("POST /human-check stores the check for the session user in public.human_checks, then the run is admitted", async () => {
    await setMode("open");
    const user = await createUser({ invited: false });
    const usage = repo();
    const gate = new LiveHumanCheckGate({
      mode: () => createSignupSettings(db()).mode(),
      checks: usage.humanCheck,
      verifierConfigured: true,
    });
    const verifier: HumanVerifier = { verify: async (token) => (token === "good" ? "ok" : "failed") };
    const app = new Hono<AuthEnv>();
    app.use(async (c, next) => {
      c.set("user", { id: user.id, email: user.email, capabilities: NO_CAPABILITIES });
      await next();
    });
    app.route("/", humanCheckRoutes({ mode: async () => "open", gate, verifier, limiter: new RateLimiter() }));
    const post = (token: string) =>
      app.request("/human-check", { method: "POST", body: JSON.stringify({ token }), headers: { "content-type": "application/json" } });

    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post("bad")).status).toBe(403);
    expect(await sql("select 1 from public.human_checks where user_id = $1", [user.id])).toEqual([]);
    const ok = await post("good");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ humanCheck: "done" });
    expect(await sql("select 1 from public.human_checks where user_id = $1", [user.id])).toHaveLength(1);

    const policy = new HostedRunPolicy({
      limits: LIMITS,
      usage,
      slots: new RunSlots({ staleAfterMs: 340_000 }),
      humanCheck: gate,
      limiter: new RateLimiter(),
    });
    const admitted = await policy.admit({ principal: { ...user, capabilities: NO_CAPABILITIES }, chatId: randomUUID(), runId: "r2" });
    expect(admitted.ok).toBe(true);
    if (admitted.ok) admitted.ticket.end();
    const fresh = new LiveHumanCheckGate({ mode: async () => "open", checks: repo().humanCheck, verifierConfigured: true });
    expect(await fresh.state(user.id)).toBe("done");
  });
});
