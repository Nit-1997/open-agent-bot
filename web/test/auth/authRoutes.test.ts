import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/auth/callback/route";
import { confirmEmailLink } from "@/app/auth/confirm/actions";
import { POST as signOut } from "@/app/auth/signout/route";
import { submitAccessRequest } from "@/app/request-access/actions";
import { signFormTs } from "@/lib/formToken";
import { createClient } from "@/lib/supabase/server";
import { AGENT_URL, APP_ORIGIN, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  set: vi.fn((name: string, value: string) => jar.set(name, value)),
  delete: vi.fn((opts: { name: string }) => jar.delete(opts.name)),
};
let requestHeaders = new Headers();

vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
}));

class Redirect extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const auth = {
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  getClaims: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth })) }));

beforeEach(() => {
  stubAgentEnv();
  jar.clear();
  requestHeaders = new Headers();
  vi.clearAllMocks();
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.getClaims.mockResolvedValue({ data: { claims: { email: "Dummy+tag@Example.com" } }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const location = (res: Response) => res.headers.get("location");
const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirect) return e.message;
    throw e;
  }
  throw new Error("expected a redirect");
};

describe("GET /auth/callback", () => {
  const call = (qs: string) => callback(new Request(`${APP_ORIGIN}/auth/callback?${qs}`));

  it("maps disabled sign-ups and the invite-only hook to not_invited", async () => {
    expect(location(await call("error=access_denied&error_code=signup_disabled"))).toBe(`${APP_ORIGIN}/login?error=not_invited`);
    expect(location(await call("error=server_error&error_description=Open%20Agent%20is%20invite-only."))).toBe(
      `${APP_ORIGIN}/login?error=not_invited`,
    );
  });

  it("maps every other failure to auth_failed and never echoes Supabase's text", async () => {
    expect(location(await call("error=access_denied&error_description=<b>nope</b>"))).toBe(`${APP_ORIGIN}/login?error=auth_failed`);
    expect(location(await call(""))).toBe(`${APP_ORIGIN}/login?error=auth_failed`);
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    expect(location(await call("code=abc"))).toBe(`${APP_ORIGIN}/login?error=auth_failed`);
  });

  it("goes to the saved next path, checked again, and clears the cookie", async () => {
    jar.set("oab_next", "/admin");
    expect(location(await call("code=abc"))).toBe(`${APP_ORIGIN}/admin`);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(cookieStore.delete).toHaveBeenCalledWith({ name: "oab_next", path: "/auth/callback" });
    jar.set("oab_next", "//evil.com");
    expect(location(await call("code=abc"))).toBe(`${APP_ORIGIN}/`);
  });
});

describe("confirmEmailLink", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  const email = "dummy+tag@example.com";

  it("verifies a valid invite or email link for the shown account and goes home", async () => {
    expect(await redirectOf(confirmEmailLink(form({ type: "invite", token_hash: "pkce_abcdef123456", email })))).toBe("/");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "pkce_abcdef123456" });
    expect(await redirectOf(confirmEmailLink(form({ type: "email", token_hash: "abcdefghijk", email })))).toBe("/");
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(cookieStore.delete).toHaveBeenCalledWith({ name: "oab_link", path: "/auth/confirm" });
  });

  it("signs straight back out when the link belongs to a different account than the one shown", async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { email: "attacker@example.com" } }, error: null });
    expect(await redirectOf(confirmEmailLink(form({ type: "email", token_hash: "abcdefghijk", email })))).toBe(
      "/login?error=link_mismatch",
    );
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it.each([
    [{ type: "signup", token_hash: "abcdefghijk" }],
    [{ type: "recovery", token_hash: "abcdefghijk" }],
    [{ type: "email", token_hash: "short" }],
    [{ type: "email", token_hash: "abc/def?ghijk" }],
    [{ type: "email", token_hash: "a".repeat(201) }],
    [{ type: "email" }],
    [{ type: "email", token_hash: "abcdefghijk" }],
    [{ type: "email", token_hash: "abcdefghijk", email: "not-an-email" }],
  ])("rejects %j without calling Supabase", async (fields) => {
    expect(await redirectOf(confirmEmailLink(form(fields as Record<string, string>)))).toBe("/login?error=link_expired");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("sends a used or expired link to link_expired", async () => {
    auth.verifyOtp.mockResolvedValue({ error: { name: "AuthApiError", message: "Token has expired or is invalid", status: 403 } });
    expect(await redirectOf(confirmEmailLink(form({ type: "email", token_hash: "abcdefghijk", email: "a@example.com" })))).toBe(
      "/login?error=link_expired",
    );
  });
});

describe("POST /auth/signout", () => {
  const post = (origin: string, scope?: string) => {
    const body = new FormData();
    if (scope) body.set("scope", scope);
    return signOut(new Request(`${APP_ORIGIN}/auth/signout`, { method: "POST", headers: { origin }, body }));
  };

  it("rejects another origin", async () => {
    expect((await post("https://evil.test")).status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("signs out locally by default and everywhere on request, then goes to /login", async () => {
    const res = await post(APP_ORIGIN);
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${APP_ORIGIN}/login`);
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: "local" });
    await post(APP_ORIGIN, "global");
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: "global" });
    await post(APP_ORIGIN, "others");
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: "local" });
  });

  it("drops the local session and says so when Supabase can't be reached", async () => {
    jar.set("sb-ref-auth-token", "x");
    auth.signOut.mockResolvedValue({ error: { message: "fetch failed" } });
    const res = await post(APP_ORIGIN, "global");
    expect(location(res)).toBe(`${APP_ORIGIN}/login?error=auth_unavailable`);
    expect(jar.has("sb-ref-auth-token")).toBe(false);
  });
});

describe("submitAccessRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => Response.json({ ok: true }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  });

  const form = (over: Record<string, string> = {}) => {
    const f = new FormData();
    const fields = {
      name: "Dummy One",
      email: " Dummy@Example.com ",
      note: "testing",
      oab_trap: "",
      form_ts: signFormTs(Date.now() - 10_000),
      ...over,
    };
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("sends a valid request with the service secret and client IP, no user token", async () => {
    expect(await submitAccessRequest({ status: "idle" }, form())).toEqual({ status: "sent" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/access-requests`);
    const headers = new Headers(init.headers);
    expect(headers.get("x-agent-secret")).toBe(SERVICE_SECRET);
    expect(headers.get("x-client-ip")).toBe("203.0.113.9");
    expect(headers.get("authorization")).toBeNull();
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ name: "Dummy One", email: "dummy@example.com", note: "testing" });
    expect(typeof sent.formToken).toBe("string");
  });

  it("drops bots silently: honeypot, forged token, too fast", async () => {
    const bots: Array<Record<string, string>> = [
      { oab_trap: "https://spam.test" },
      { form_ts: "123.forged" },
      { form_ts: signFormTs(Date.now()) },
    ];
    for (const over of bots) {
      expect(await submitAccessRequest({ status: "idle" }, form(over))).toEqual({ status: "sent" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains malformed fields without calling the agent", async () => {
    const state = await submitAccessRequest({ status: "idle" }, form({ name: " ", email: "nope", note: "x".repeat(1001) }));
    expect(state.status).toBe("invalid");
    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual(["email", "name", "note"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
