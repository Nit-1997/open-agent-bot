import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";
import { SESSION_MAX_AGE_SECONDS, sessionCookieOptions } from "@/lib/supabase/cookies";
import nextConfig from "../next.config";

const SUPABASE = "https://ref.supabase.co";

const directives = (csp: string) => new Map(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)] as const));

describe("contentSecurityPolicy", () => {
  it("keeps frames, framing, plugins and base URLs locked to the app", () => {
    const d = directives(contentSecurityPolicy("abc", SUPABASE, false));
    expect(d.get("frame-src")).toEqual(["'self'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'none'"]);
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.get("default-src")).toEqual(["'self'"]);
  });

  it("allows scripts only by nonce and never eval outside development", () => {
    expect(directives(contentSecurityPolicy("abc", SUPABASE, false)).get("script-src")).toEqual([
      "'self'",
      "'nonce-abc'",
      "'strict-dynamic'",
    ]);
    expect(directives(contentSecurityPolicy("abc", SUPABASE, true)).get("script-src")).toContain("'unsafe-eval'");
  });

  it("posts forms only to the app, Google and Supabase", () => {
    expect(directives(contentSecurityPolicy("abc", SUPABASE, false)).get("form-action")).toEqual([
      "'self'",
      "https://accounts.google.com",
      SUPABASE,
    ]);
  });
});

describe("sessionCookieOptions", () => {
  it("caps the 400-day @supabase/ssr default at the Supabase session timebox", () => {
    expect(sessionCookieOptions({ path: "/", maxAge: 400 * 24 * 60 * 60 }).maxAge).toBe(SESSION_MAX_AGE_SECONDS);
    expect(SESSION_MAX_AGE_SECONDS).toBe(720 * 60 * 60);
  });

  it("keeps deletions and shorter lifetimes as they are", () => {
    expect(sessionCookieOptions({ maxAge: 0 }).maxAge).toBe(0);
    expect(sessionCookieOptions({ maxAge: 60 }).maxAge).toBe(60);
    expect(sessionCookieOptions({}).maxAge).toBe(SESSION_MAX_AGE_SECONDS);
  });
});

describe("next.config", () => {
  it("doesn't advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
