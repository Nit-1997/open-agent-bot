import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS owner script without type declarations
import { cleanupTestUsers } from "../../../../supabase/scripts/cleanup-e2e.mjs";
// @ts-expect-error plain JS owner script without type declarations
import { createAdmin } from "../../../../supabase/scripts/admin.mjs";
import { isTestEmail, TEST_EMAIL_PATTERN } from "../../../../supabase/scripts/test-users.mjs";

const URL_BASE = "https://stub.supabase.test";

type User = { id: string; email: string };

function stubSupabase(authUsers: User[], profiles: Array<{ user_id: string; email: string }>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const line = `${init.method ?? "GET"} ${url.pathname}${decodeURIComponent(url.search)}`;
    calls.push(line);
    if (url.pathname === "/auth/v1/admin/users") {
      const page = Number(url.searchParams.get("page"));
      return new Response(JSON.stringify({ users: page === 1 ? authUsers : [] }), { status: 200 });
    }
    if (url.pathname === "/rest/v1/profiles") return new Response(JSON.stringify(profiles), { status: 200 });
    if (url.pathname.includes("/object/list/")) return new Response("[]", { status: 200 });
    return new Response(null, { status: 204 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("test user email pattern", () => {
  it("is the one oab-e2e pattern", () => {
    expect(TEST_EMAIL_PATTERN).toBe("oab-e2e+%@example.test");
  });

  it.each(["oab-e2e+shell@example.test", "oab-e2e+spike-a@example.test"])("matches %s", (email) => {
    expect(isTestEmail(email)).toBe(true);
  });

  it.each([
    "oab-eval@example.test",
    "oab-test+1@example.test",
    "x-oab-e2e+a@example.test",
    "oab-e2e+a@example.test.evil",
    "oab-e2e+@example.test",
    "oab-e2e+a@b@example.test",
    "ntnbhat9+oab-e2e1@gmail.com",
    "owner@gmail.com",
    "",
  ])("does not match %s", (email) => {
    expect(isTestEmail(email)).toBe(false);
  });
});

describe("supabase/scripts/cleanup-e2e.mjs", () => {
  it("deletes test users from profiles and from auth even without a profile row, and nobody else", async () => {
    const calls = stubSupabase(
      [
        { id: "a1", email: "oab-e2e+shell@example.test" },
        { id: "a2", email: "oab-e2e+orphan@example.test" },
        { id: "a3", email: "oab-eval@example.test" },
        { id: "a4", email: "owner@gmail.com" },
        { id: "a5", email: "oab-test+x@example.test" },
      ],
      [{ user_id: "a1", email: "oab-e2e+shell@example.test" }],
    );
    const deleted = await cleanupTestUsers(createAdmin({ url: URL_BASE, key: "sb_secret_test" }));
    expect(deleted.sort()).toEqual(["a1", "a2"]);
    const authDeletes = calls.filter((c) => c.startsWith("DELETE /auth/v1/admin/users/"));
    expect(authDeletes.sort()).toEqual(["DELETE /auth/v1/admin/users/a1", "DELETE /auth/v1/admin/users/a2"]);
    const like = calls.filter((c) => c.includes("like."));
    expect(like.length).toBeGreaterThan(0);
    for (const c of like) expect(c).toContain(`like.${TEST_EMAIL_PATTERN}`);
    expect(calls.some((c) => c.includes("gmail") || c.includes("like.%@example.test"))).toBe(false);
  });
});
