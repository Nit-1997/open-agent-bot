import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as chat } from "@/app/api/chats/[id]/route";
import { GET as plan } from "@/app/api/plans/[chatId]/[kind]/[key]/route";
import { GET as plans } from "@/app/api/plans/route";
import { GET as report } from "@/app/api/reports/[id]/route";
import { GET as reports } from "@/app/api/reports/route";
import { GET as search } from "@/app/api/search/route";
import { getAgentAuth } from "@/lib/auth";
import { AGENT_URL, APP_ORIGIN, AUTH, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getAgentAuth: vi.fn() }));

const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubAgentEnv();
  vi.mocked(getAgentAuth).mockResolvedValue(AUTH);
  fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const req = (path: string) => new Request(`${APP_ORIGIN}${path}`);
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const forwarded = () => String(fetchMock.mock.calls.at(-1)?.[0]).replace(AGENT_URL, "");

describe("shell API routes", () => {
  it.each([
    ["chat", () => chat(req("/api/chats/x"), params({ id: "not-a-uuid" })), 404],
    ["reports page", () => reports(req("/api/reports?page=0")), 400],
    ["report id", () => report(req("/api/reports/.."), params({ id: ".." })), 404],
    ["plans page", () => plans(req("/api/plans?page=abc")), 400],
    ["plans kind", () => plans(req("/api/plans?kind=boat")), 400],
    ["plan chat", () => plan(req("/x"), params({ chatId: "x", kind: "trip", key: "dDE" })), 404],
    ["plan kind", () => plan(req("/x"), params({ chatId: CHAT, kind: "boat", key: "dDE" })), 404],
    ["plan key", () => plan(req("/x"), params({ chatId: CHAT, kind: "trip", key: "dDF" })), 404],
    ["plan dots", () => plan(req("/x"), params({ chatId: CHAT, kind: "trip", key: ".." })), 404],
    ["search short", () => search(req("/api/search?q=a")), 400],
    ["search long", () => search(req(`/api/search?q=${"a".repeat(101)}`)), 400],
    ["search scope", () => search(req("/api/search?q=ab&scope=plans")), 400],
    ["search far page", () => search(req("/api/search?q=ab&page=1002")), 400],
  ])("answers %s without calling the agent", async (_name, call, status) => {
    expect((await call()).status).toBe(status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards valid requests to the right agent path", async () => {
    await chat(req(`/api/chats/${CHAT.toUpperCase()}`), params({ id: CHAT.toUpperCase() }));
    expect(forwarded()).toBe(`/chats/${CHAT}`);
    await reports(req("/api/reports?page=2"));
    expect(forwarded()).toBe("/reports?page=2");
    await report(req("/api/reports/AbCdEf_-1234"), params({ id: "AbCdEf_-1234" }));
    expect(forwarded()).toBe("/reports/AbCdEf_-1234");
    await plans(req("/api/plans?kind=trip&page=3"));
    expect(forwarded()).toBe("/plans?page=3&kind=trip");
    await plan(req("/x"), params({ chatId: CHAT, kind: "trip", key: "dDE" }));
    expect(forwarded()).toBe(`/plans/${CHAT}/trip/dDE`);
    await search(req("/api/search?q=%20big%20%20sur/%3F%23&scope=chats&page=2"));
    expect(forwarded()).toBe(`/search?q=${encodeURIComponent("big sur/?#")}&scope=chats&page=2`);
  });
});
