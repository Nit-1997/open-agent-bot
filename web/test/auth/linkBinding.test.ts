import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestEmailLink } from "@/app/login/actions";
import { isBoundTo, linkBinding } from "@/lib/authCookies";
import { errorCodeIn, noteRunFailure, resetAuthState } from "@/lib/authState";
import { notSavedMessage } from "@/lib/errors";
import { stubAgentEnv } from "../support/agentEnv";

const jar = new Map<string, { value: string; opts: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string, opts: Record<string, unknown>) => jar.set(name, { value, opts }) }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

beforeEach(() => {
  stubAgentEnv();
  jar.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const form = (email: string) => {
  const f = new FormData();
  f.set("email", email);
  return f;
};

describe("email link binding", () => {
  it("marks this browser as the one that asked, scoped to the confirm page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true }, { status: 202 })),
    );
    expect(await requestEmailLink({ status: "idle" }, form(" Me@Example.test "))).toEqual({ status: "sent" });
    const cookie = jar.get("oab_link");
    expect(cookie?.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/auth/confirm" });
    expect(isBoundTo(cookie?.value, "me@example.test")).toBe(true);
    expect(isBoundTo(cookie?.value, "other@example.test")).toBe(false);
  });

  it("sets no binding when the agent can't take the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "internal" }, { status: 500 })),
    );
    expect((await requestEmailLink({ status: "idle" }, form("me@example.test"))).status).toBe("error");
    expect(jar.has("oab_link")).toBe(false);
  });

  it("binds with a key the browser can't forge", () => {
    expect(linkBinding("me@example.test")).not.toBe(linkBinding("me@example.test", "f".repeat(64)));
    expect(isBoundTo(undefined, "me@example.test")).toBe(false);
  });
});

describe("structured run failures", () => {
  it("reads the error code from the agent's JSON body, not from free text", () => {
    expect(errorCodeIn('HTTP 403: {"error":"account_disabled","message":"x"}')).toBe("account_disabled");
    expect(errorCodeIn("the words signed_out and account_disabled in prose")).toBeUndefined();
    resetAuthState();
    expect(() => noteRunFailure(undefined)).not.toThrow();
  });

  it("falls back to a clear sentence when a not-saved event has no message", () => {
    expect(notSavedMessage({ message: "Your message wasn't saved." })).toBe("Your message wasn't saved.");
    expect(notSavedMessage(null)).toBe("This reply wasn't saved, so it won't be in this chat's history.");
  });
});
