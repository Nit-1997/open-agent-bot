import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS owner script without type declarations
import { countTestUsers, formatCounts } from "../../../supabase/scripts/count-test-users.mjs";

const URL_BASE = "https://stub.supabase.test";

function stubSupabase(authPages: string[][], tables: Record<string, number>, rows: Record<string, string[]> = {}) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    seen.push(`${init.method ?? "GET"} ${url.pathname}${url.search}`);
    const name = url.pathname.replace("/rest/v1/", "");
    if ((init.method ?? "GET") === "GET" && name in rows)
      return new Response(JSON.stringify(rows[name]!.map((email) => ({ email }))), { status: 200 });
    if (url.pathname === "/auth/v1/admin/users") {
      const page = Number(url.searchParams.get("page"));
      const emails = authPages[page - 1] ?? [];
      return new Response(JSON.stringify({ users: emails.map((email) => ({ email })) }), { status: 200 });
    }
    const table = url.pathname.replace("/rest/v1/", "");
    return new Response(null, { status: 200, headers: { "content-range": `*/${tables[table] ?? 0}` } });
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("cloud/supabase/scripts/count-test-users.mjs", () => {
  it("counts only oab-e2e test users across auth and the email tables", async () => {
    const seen = stubSupabase(
      [["oab-e2e+shell@example.test", "owner@gmail.com", "oab-e2e+other@example.test", "x-oab-e2e+a@example.test"]],
      { profiles: 2, invited_emails: 1, access_requests: 0 },
    );
    const counts = await countTestUsers({ url: URL_BASE, key: "sb_secret_test" });
    expect(counts).toEqual({ auth_users: 2, profiles: 2, invited_emails: 1, access_requests: 0 });
    const rest = seen.filter((s) => s.startsWith("HEAD /rest/v1/"));
    expect(rest).toHaveLength(3);
    for (const line of rest) expect(decodeURIComponent(line)).toContain("email=like.oab-e2e+%@example.test");
  });

  it("never counts oab-test users in default mode", async () => {
    const seen = stubSupabase([["oab-test+0b7c6f2e-3d4a-4e5f-8a9b-1c2d3e4f5a6b@example.test"]], {});
    expect((await countTestUsers({ url: URL_BASE, key: "k" })).auth_users).toBe(0);
    expect(seen.some((s) => decodeURIComponent(s).includes("oab-test"))).toBe(false);
  });

  it("counts only oab-test+<uuid> users with --integration", async () => {
    const valid = "oab-test+0b7c6f2e-3d4a-4e5f-8a9b-1c2d3e4f5a6b@example.test";
    const seen = stubSupabase(
      [[valid, "oab-test+x@example.test", "oab-e2e+shell@example.test", "owner@gmail.com"]],
      {},
      { profiles: [valid, "oab-test+x@example.test"], invited_emails: [valid], access_requests: ["oab-test+x@example.test"] },
    );
    const counts = await countTestUsers({ url: URL_BASE, key: "k" }, { integration: true });
    expect(counts).toEqual({ auth_users: 1, profiles: 1, invited_emails: 1, access_requests: 0 });
    const rest = seen.filter((s) => s.includes("/rest/v1/"));
    expect(rest).toHaveLength(3);
    for (const line of rest) expect(decodeURIComponent(line)).toContain("email=like.oab-test+%@example.test");
  });

  it("pages through every auth user", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => (i < 3 ? `oab-e2e+u${i}@example.test` : `u${i}@x.test`));
    stubSupabase([full, ["oab-e2e+last@example.test"]], {});
    const counts = await countTestUsers({ url: URL_BASE, key: "k" });
    expect(counts.auth_users).toBe(4);
  });

  it("fails explicitly when a count is missing", async () => {
    vi.stubGlobal("fetch", async (input: string) =>
      input.includes("/auth/") ? new Response(JSON.stringify({ users: [] })) : new Response(null, { status: 200 }),
    );
    await expect(countTestUsers({ url: URL_BASE, key: "k" })).rejects.toThrow(/profiles: no count/);
  });

  it("fails explicitly on an HTTP error", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(countTestUsers({ url: URL_BASE, key: "k" })).rejects.toThrow(/401/);
  });

  it("formats one line per count and reports whether any test data remains", () => {
    expect(formatCounts({ auth_users: 0, profiles: 0, invited_emails: 0, access_requests: 0 })).toEqual({
      lines: ["auth_users 0", "profiles 0", "invited_emails 0", "access_requests 0"],
      clean: true,
    });
    expect(formatCounts({ auth_users: 0, profiles: 1, invited_emails: 0, access_requests: 0 }).clean).toBe(false);
  });
});
