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

  it("keeps the open report on a chat link through sign-in", async () => {
    const chat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const res = await proxy(new NextRequest(`${APP_ORIGIN}/chats/${chat}?report=AbCdEf_-1234`));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe(`/chats/${chat}?report=AbCdEf_-1234`);
  });

  it("sends an unknown page to /", async () => {
    const res = await proxy(new NextRequest(`${APP_ORIGIN}/nowhere?x=1`));
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("next")).toBe("/");
  });
});

describe("proxy landing page", () => {
  const frameSrc = (res: Response) => (res.headers.get("content-security-policy") ?? "").split("; ").find((d) => d.startsWith("frame-src"));

  it("shows signed-out visitors the landing page with the YouTube player allowed", async () => {
    for (const path of ["/", "/landing"]) {
      const res = await proxy(new NextRequest(`${APP_ORIGIN}${path}`));
      expect(res.status).toBe(200);
      expect(frameSrc(res)).toBe("frame-src 'self' https://www.youtube-nocookie.com");
    }
  });

  it("keeps frames locked to the app everywhere else", async () => {
    const res = await proxy(new NextRequest(`${APP_ORIGIN}/login`));
    expect(frameSrc(res)).toBe("frame-src 'self'");
  });

  it("gives signed-in users the app at / without the YouTube allowance", async () => {
    vi.mocked(updateSession).mockResolvedValue({
      response: NextResponse.next(),
      session: { user: { id: "u1", email: "a@b.c", name: "", isAdmin: false }, unavailable: false },
    });
    const res = await proxy(new NextRequest(`${APP_ORIGIN}/`));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(frameSrc(res)).toBe("frame-src 'self'");
  });
});

describe("proxy signed-out report frames", () => {
  const url = `${APP_ORIGIN}/api/artifacts/AbCdEf_-1234`;

  it("gives a framed report request the HTML error page with the report CSP", async () => {
    for (const dest of ["iframe", "frame", "document"]) {
      const res = await proxy(new NextRequest(url, { headers: { "sec-fetch-dest": dest } }));
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(await res.text()).toContain("This report couldn't be loaded.");
    }
  });

  it("keeps JSON for fetches, PDFs and thumbnails", async () => {
    for (const [path, dest] of [
      ["", "empty"],
      ["?format=pdf", "document"],
      ["?format=thumb", "image"],
    ]) {
      const res = await proxy(new NextRequest(`${url}${path}`, { headers: { "sec-fetch-dest": dest } }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "signed_out" });
    }
  });
});
