import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSignupModeCache, SIGNUP_MODE_TTL_MS, signupMode, signupSettings } from "@/lib/signupMode";
import { AGENT_URL, headersOf, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubAgentEnv();
  resetSignupModeCache();
  fetchMock = vi.fn(async () => Response.json({ mode: "open", captcha: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("signupMode() (web, cached 60 s)", () => {
  it("asks the agent's GET /signup with the service secret and caches the answer for 60 s", async () => {
    const clock = { now: 0 };
    expect(await signupMode(() => clock.now)).toBe("open");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${AGENT_URL}/signup`);
    expect(headersOf(fetchMock.mock.calls[0]!).get("x-agent-secret")).toBe(SERVICE_SECRET);
    fetchMock.mockResolvedValue(Response.json({ mode: "invite", captcha: false }));
    clock.now = SIGNUP_MODE_TTL_MS - 1;
    expect(await signupMode(() => clock.now)).toBe("open");
    clock.now = SIGNUP_MODE_TTL_MS;
    expect(await signupMode(() => clock.now)).toBe("invite");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows waitlist (never open) for an error, a bad answer or an unreachable agent, and caches none of them", async () => {
    for (const r of [
      () => Promise.resolve(Response.json({ error: "x" }, { status: 503 })),
      () => Promise.resolve(Response.json({ mode: "everyone", captcha: true })),
      () => Promise.resolve(Response.json({ mode: "open" })),
      () => Promise.resolve(Response.json({ mode: "invite", captcha: "no" })),
      () => Promise.resolve(new Response("<html>", { status: 200 })),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      fetchMock.mockImplementationOnce(r);
      expect(await signupMode()).toBe("waitlist");
    }
    expect(await signupMode()).toBe("open");
  });

  it("reads the captcha flag with the mode, so the widget shows whenever the agent asks for it", async () => {
    for (const body of [
      { mode: "open", captcha: true },
      { mode: "waitlist", captcha: true },
      { mode: "waitlist", captcha: false },
      { mode: "invite", captcha: false },
    ]) {
      resetSignupModeCache();
      fetchMock.mockResolvedValueOnce(Response.json(body));
      expect(await signupSettings()).toEqual(body);
    }
  });

  it("asks for the human check when the answer is missing, malformed or unreachable", async () => {
    for (const r of [
      () => Promise.resolve(Response.json({ error: "x" }, { status: 503 })),
      () => Promise.resolve(Response.json({ mode: "open" })),
      () => Promise.resolve(Response.json({ mode: "invite", captcha: "no" })),
      () => Promise.resolve(new Response("<html>", { status: 200 })),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      fetchMock.mockImplementationOnce(r);
      expect(await signupSettings()).toEqual({ mode: "waitlist", captcha: true });
    }
  });
});
