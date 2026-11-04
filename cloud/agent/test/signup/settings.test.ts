import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignupSettings, SIGNUP_SETTINGS_TTL_MS, SignupLookupError } from "../../src/signup/settings.js";
import type { Db } from "../../src/store/client.js";

afterEach(() => vi.restoreAllMocks());

type Answer = { data?: unknown; error?: { code: string } | null; throws?: boolean; hang?: boolean };

function fakeDb(answers: Record<string, () => Answer>) {
  const calls: string[] = [];
  const db = {
    rpc(name: string) {
      calls.push(name);
      return {
        abortSignal: (signal: AbortSignal) => {
          const a = answers[name]!();
          if (a.hang)
            return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
          if (a.throws) return Promise.reject(new Error("network down"));
          return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
        },
      };
    },
  };
  return { db: db as unknown as Db, calls };
}

const row = (mode: string) => [{ mode, signups_per_hour: 20, signups_per_day: 100, signups_per_ip_day: 3 }];

describe("createSignupSettings().mode()", () => {
  it("reads the mode once and caches it for 60 s", async () => {
    const clock = { now: 0 };
    let mode = "open";
    const { db, calls } = fakeDb({ signup_settings_get: () => ({ data: row(mode) }) });
    const s = createSignupSettings(db, { now: () => clock.now });
    expect(await s.mode()).toBe("open");
    mode = "waitlist";
    clock.now = SIGNUP_SETTINGS_TTL_MS - 1;
    expect(await s.mode()).toBe("open");
    clock.now = SIGNUP_SETTINGS_TTL_MS;
    expect(await s.mode()).toBe("waitlist");
    expect(calls).toEqual(["signup_settings_get", "signup_settings_get"]);
  });

  it("shares one lookup between concurrent callers", async () => {
    const { db, calls } = fakeDb({ signup_settings_get: () => ({ data: row("invite") }) });
    const s = createSignupSettings(db);
    expect(await Promise.all([s.mode(), s.mode(), s.mode()])).toEqual(["invite", "invite", "invite"]);
    expect(calls).toHaveLength(1);
  });

  it("answers unknown on an error, a network failure, a timeout or a bad row, logs it and doesn't cache it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const answer of [
      { error: { code: "42501" } },
      { throws: true },
      { hang: true },
      { data: [] },
      { data: row("everyone") },
      { data: [...row("open"), ...row("open")] },
    ] satisfies Answer[]) {
      let next: Answer = answer;
      const { db, calls } = fakeDb({ signup_settings_get: () => next });
      const s = createSignupSettings(db, { timeoutMs: 20 });
      expect(await s.mode()).toBe("unknown");
      next = { data: row("open") };
      expect(await s.mode()).toBe("open");
      expect(calls).toHaveLength(2);
    }
    expect(warn.mock.calls.flat().join(" ")).toContain("[signup] mode lookup failed, treating the mode as unknown");
  });
});

describe("createSignupSettings().stats()", () => {
  it("maps the counts and caps", async () => {
    const { db } = fakeDb({ signup_stats: () => ({ data: [{ last_hour: 4, last_day: 31, cap_hour: 20, cap_day: 100 }] }) });
    expect(await createSignupSettings(db).stats()).toEqual({ lastHour: 4, lastDay: 31, capHour: 20, capDay: 100 });
  });

  it("throws a SignupLookupError with the code on failure or a bad row", async () => {
    const { db } = fakeDb({ signup_stats: () => ({ error: { code: "PGRST202" } }) });
    await expect(createSignupSettings(db).stats()).rejects.toMatchObject({ name: "SignupLookupError", code: "PGRST202" });
    const bad = fakeDb({ signup_stats: () => ({ data: [{ last_hour: -1, last_day: 0, cap_hour: 20, cap_day: 100 }] }) });
    await expect(createSignupSettings(bad.db).stats()).rejects.toBeInstanceOf(SignupLookupError);
  });
});
