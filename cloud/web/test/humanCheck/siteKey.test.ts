import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";
import { siteKeyProblem, TURNSTILE_ORIGIN, turnstileSiteKey } from "@/lib/turnstile";

afterEach(() => vi.unstubAllEnvs());

const REAL = "0x4AAAAAAAB5rGc7r3b0Ifk0";
const LOCAL = "http://127.0.0.1:18741";
const HOSTED = "https://abcdefghijklmnopqrst.supabase.co";

describe("NEXT_PUBLIC_TURNSTILE_SITE_KEY", () => {
  it("is optional", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBeUndefined();
  });

  it("accepts a real key anywhere and the Cloudflare test keys only with a 127.0.0.1 Supabase on a factory port", () => {
    expect(siteKeyProblem(REAL, HOSTED)).toBeUndefined();
    for (const key of ["1x00000000000000000000AA", "2x00000000000000000000AB", "3x00000000000000000000FF"]) {
      expect(siteKeyProblem(key, LOCAL)).toBeUndefined();
      for (const url of [HOSTED, "http://127.0.0.1:54321", "http://localhost:18741", undefined])
        expect(siteKeyProblem(key, url), `${key} ${url}`).toMatch(/is a Cloudflare test key/);
    }
  });

  it("refuses a malformed key, and turnstileSiteKey throws a ConfigError naming the variable only", () => {
    expect(siteKeyProblem("nope", HOSTED)).toBe("NEXT_PUBLIC_TURNSTILE_SITE_KEY is invalid");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED);
    expect(() => turnstileSiteKey()).toThrow(expect.objectContaining({ name: "ConfigError" }));
    expect(() => turnstileSiteKey()).not.toThrow(/1x0000/);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", LOCAL);
    expect(turnstileSiteKey()).toBe("1x00000000000000000000AA");
  });
});

describe("CSP with Turnstile", () => {
  const directives = (csp: string) => new Map(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)] as const));

  it("adds challenges.cloudflare.com to script-src and frame-src only when asked", () => {
    const off = directives(contentSecurityPolicy("abc", HOSTED, false));
    expect(off.get("script-src")).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(off.get("frame-src")).toEqual(["'self'"]);
    const on = directives(contentSecurityPolicy("abc", HOSTED, false, [TURNSTILE_ORIGIN], [TURNSTILE_ORIGIN]));
    expect(on.get("script-src")).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'", "https://challenges.cloudflare.com"]);
    expect(on.get("frame-src")).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(on.get("connect-src")).toEqual(["'self'"]);
  });
});

describe("next.config at build time", () => {
  const load = async () => {
    vi.resetModules();
    return (await import("../../next.config")).default;
  };

  it("fails the build on a malformed key or a test key without a local Supabase, naming only the variable", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "not-a-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOSTED);
    await expect(load()).rejects.toThrow("NEXT_PUBLIC_TURNSTILE_SITE_KEY is invalid");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    await expect(load()).rejects.toThrow(/NEXT_PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key/);
  });

  it("builds with no key, a real key, or a test key against a local stack", async () => {
    for (const [key, url] of [
      ["", HOSTED],
      [REAL, HOSTED],
      ["1x00000000000000000000AA", LOCAL],
    ] as const) {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", key);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect((await load()).poweredByHeader, `${key} ${url}`).toBe(false);
    }
  });
});
