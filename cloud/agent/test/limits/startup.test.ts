import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSignupFunctions, checkUsageFunctions, GATE8_REFUSAL } from "../../src/limits/startup.js";
import { SignupLookupError } from "../../src/signup/settings.js";
import { UsageRepoError } from "../../src/limits/usageRepo.js";

const repo = (summary: () => Promise<{ monthTotal: number; activeUsers: number }>) => ({ summary });

afterEach(() => vi.restoreAllMocks());

describe("usage functions startup check", () => {
  it("passes when request_usage_summary answers", async () => {
    expect(await checkUsageFunctions(repo(async () => ({ monthTotal: 0, activeUsers: 0 })))).toBe("ok");
  });

  it.each(["PGRST202", "42501"])("refuses to start when PostgREST answers %s", async (code) => {
    expect(await checkUsageFunctions(repo(() => Promise.reject(new UsageRepoError("summary", code))))).toBe("missing");
  });

  it.each(["timeout", "unreachable", "invalid_row", "PGRST301"])(
    "only logs any other error (%s), so runs fail closed later",
    async (code) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await checkUsageFunctions(repo(() => Promise.reject(new UsageRepoError("summary", code))))).toBe("unknown");
      expect(warn.mock.calls.flat().join(" ")).toContain(`[limits] usage startup check failed (${code})`);
    },
  );

  it("names Gate 8 in the refusal", () => {
    expect(GATE8_REFUSAL).toBe(
      "refusing to start: the M7 usage functions are missing or not executable (apply the migrations first: Gate 8)",
    );
  });
});

describe("signup functions startup check", () => {
  const signup = (probe: () => Promise<"open" | "waitlist" | "invite">) => ({ probe });

  it("passes when signup_settings_get answers, without the Turnstile warning outside open mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await checkSignupFunctions(
        signup(async () => "waitlist"),
        false,
      ),
    ).toBe("ok");
    expect(
      await checkSignupFunctions(
        signup(async () => "open"),
        true,
      ),
    ).toBe("ok");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once at start when the mode is open and no Turnstile secret is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await checkSignupFunctions(
        signup(async () => "open"),
        false,
      ),
    ).toBe("ok");
    expect(warn.mock.calls.flat().join(" ")).toContain("[signup] open mode needs TURNSTILE_SECRET_KEY");
  });

  it.each(["PGRST202", "42501"])("refuses to start when PostgREST answers %s", async (code) => {
    expect(
      await checkSignupFunctions(
        signup(() => Promise.reject(new SignupLookupError("settings", code))),
        true,
      ),
    ).toBe("missing");
  });

  it.each(["timeout", "unreachable", "invalid_row"])("only logs any other error (%s)", async (code) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await checkSignupFunctions(
        signup(() => Promise.reject(new SignupLookupError("settings", code))),
        true,
      ),
    ).toBe("unknown");
    expect(warn.mock.calls.flat().join(" ")).toContain(`[signup] signup settings startup check failed (${code})`);
  });
});
