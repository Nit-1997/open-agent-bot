import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { updateSession } from "@/lib/supabase/proxy";
import { APP_ORIGIN, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/supabase/proxy", () => ({ updateSession: vi.fn() }));

beforeEach(() => {
  stubAgentEnv();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.mocked(updateSession).mockResolvedValue({ response: NextResponse.next(), session: { user: null, unavailable: false } });
});

afterEach(() => vi.unstubAllEnvs());

describe("proxy sign-in redirect", () => {
  it("passes the path and the query to safeNext so a shell route survives sign-in", async () => {
    const res = await proxy(new NextRequest(`${APP_ORIGIN}/search?q=tacos&scope=chats&evil=1`));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/search?q=tacos&scope=chats");
  });

  it("sends an unknown page to /", async () => {
    const res = await proxy(new NextRequest(`${APP_ORIGIN}/nowhere?x=1`));
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("next")).toBe("/");
  });
});
