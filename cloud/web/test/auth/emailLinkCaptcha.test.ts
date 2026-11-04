import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestEmailLink } from "@/app/login/actions";
import { stubAgentEnv } from "../support/agentEnv";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => {} }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stubAgentEnv();
  fetchMock = vi.fn(async () => Response.json({ ok: true }, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));

describe("requestEmailLink with the Turnstile token", () => {
  it("sends captchaToken to the agent when the form has one, and nothing extra when it doesn't", async () => {
    expect(await requestEmailLink({ status: "idle" }, form({ email: "me@example.test", captchaToken: "tok-1" }))).toEqual({
      status: "sent",
    });
    expect(sentBody()).toEqual({ email: "me@example.test", captchaToken: "tok-1" });
    fetchMock.mockClear();
    await requestEmailLink({ status: "idle" }, form({ email: "me@example.test" }));
    expect(sentBody()).toEqual({ email: "me@example.test" });
  });

  it("shows 'We couldn't verify that' when the agent refuses the check (403), and the unavailable copy on 503", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "human_check_failed" }, { status: 403 }));
    expect(await requestEmailLink({ status: "idle" }, form({ email: "me@example.test", captchaToken: "bad" }))).toEqual({
      status: "invalid",
      message: "We couldn't verify that. Try again.",
    });
    fetchMock.mockResolvedValueOnce(Response.json({ error: "human_check_unavailable" }, { status: 503 }));
    expect((await requestEmailLink({ status: "idle" }, form({ email: "me@example.test" }))).message).toBe(
      "Can't send links right now. Try again in a minute.",
    );
  });
});
