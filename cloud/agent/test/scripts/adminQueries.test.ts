import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS owner script without type declarations
import { createAdmin } from "../../../../supabase/scripts/admin.mjs";

const admin = () => createAdmin({ url: "https://stub.supabase.test", key: "sb_secret_test" });

afterEach(() => vi.unstubAllGlobals());

describe("supabase/scripts/admin.mjs queries", () => {
  it("lists one page of auth users", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      seen.push(input);
      return new Response(JSON.stringify({ users: [{ id: "u1", email: "a@example.test" }] }), { status: 200 });
    });
    expect(await admin().listUsers(3)).toEqual([{ id: "u1", email: "a@example.test" }]);
    expect(seen).toEqual(["https://stub.supabase.test/auth/v1/admin/users?page=3&per_page=1000"]);
  });

  it("counts rows whose email matches a LIKE pattern with an exact HEAD count", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      request = { url, init };
      return new Response(null, { status: 200, headers: { "content-range": "*/7" } });
    });
    expect(await admin().countLike("profiles", "oab-e2e+%@example.test")).toBe(7);
    expect(request?.init.method).toBe("HEAD");
    expect(new Headers(request?.init.headers).get("prefer")).toBe("count=exact");
    expect(decodeURIComponent(request?.url ?? "")).toContain("/rest/v1/profiles?select=*&email=like.oab-e2e+%@example.test");
  });

  it("fails explicitly when a count is missing or the request fails", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
    await expect(admin().countLike("profiles", "x%")).rejects.toThrow(/profiles: no count/);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 401 }));
    await expect(admin().countLike("profiles", "x%")).rejects.toThrow(/profiles: HTTP 401/);
  });
});
