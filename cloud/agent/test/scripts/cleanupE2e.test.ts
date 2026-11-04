import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS owner script without type declarations
import { cleanupIntegrationUsers, cleanupTestUsers } from "../../../supabase/scripts/cleanup-e2e.mjs";
// @ts-expect-error plain JS owner script without type declarations
import { createAdmin } from "../../../supabase/scripts/admin.mjs";
import {
  emailRows,
  INTEGRATION_EMAIL_PATTERN,
  isIntegrationEmail,
  isTestEmail,
  TEST_EMAIL_PATTERN,
} from "../../../supabase/scripts/test-users.mjs";

const URL_BASE = "https://stub.supabase.test";
const UUID = "0b7c6f2e-3d4a-4e5f-8a9b-1c2d3e4f5a6b";
const INTEGRATION = `oab-test+${UUID}@example.test`;

type User = { id: string; email: string };

function stubSupabase(authUsers: User[], profiles: Array<{ user_id: string; email: string }>, emailTables: Record<string, string[]> = {}) {
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
    const table = url.pathname.replace("/rest/v1/", "");
    if ((init.method ?? "GET") === "GET" && table in emailTables)
      return new Response(JSON.stringify(emailTables[table]!.map((email) => ({ email }))), { status: 200 });
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

describe("integration test user email pattern", () => {
  it("is the oab-test pattern", () => {
    expect(INTEGRATION_EMAIL_PATTERN).toBe("oab-test+%@example.test");
  });

  it("matches an oab-test user with a lower-case uuid", () => {
    expect(isIntegrationEmail(INTEGRATION)).toBe(true);
  });

  it.each([
    "oab-test+x@example.test",
    "oab-eval@example.test",
    `oab-test+${UUID.toUpperCase()}@example.test`,
    `oab-test+${UUID}x@example.test`,
    `oab-test+${UUID}@example.test.evil`,
    `x-oab-test+${UUID}@example.test`,
    "oab-e2e+shell@example.test",
    "",
  ])("does not match %s", (email) => {
    expect(isIntegrationEmail(email)).toBe(false);
  });
});

describe("cloud/supabase/scripts/cleanup-e2e.mjs", () => {
  it("never touches oab-test users in default mode", async () => {
    const calls = stubSupabase(
      [
        { id: "a1", email: "oab-e2e+shell@example.test" },
        { id: "t1", email: INTEGRATION },
      ],
      [],
    );
    const deleted = await cleanupTestUsers(createAdmin({ url: URL_BASE, key: "sb_secret_test" }));
    expect(deleted).toEqual(["a1"]);
    expect(calls.some((c) => c.includes("oab-test") || c.includes("/t1"))).toBe(false);
  });

  it("sweeps oab-test+<uuid> users with --integration and deletes invite and access rows by exact email", async () => {
    const other = "oab-test+1f2e3d4c-5b6a-4987-a654-3210fedcba98@example.test";
    const calls = stubSupabase(
      [
        { id: "t1", email: INTEGRATION },
        { id: "t2", email: "oab-test+x@example.test" },
        { id: "e1", email: "oab-e2e+shell@example.test" },
        { id: "o1", email: "owner@gmail.com" },
      ],
      [
        { user_id: "t1", email: INTEGRATION },
        { user_id: "t3", email: other },
        { user_id: "t4", email: "oab-test+x@example.test" },
      ],
      { invited_emails: [INTEGRATION, "oab-test+x@example.test", other], access_requests: ["oab-test+x@example.test", other] },
    );
    const env = { url: URL_BASE, key: "sb_secret_test" };
    const deleted = await cleanupIntegrationUsers(createAdmin(env), emailRows(env));
    expect(deleted.sort()).toEqual(["t1", "t3"]);
    const authDeletes = calls.filter((c) => c.startsWith("DELETE /auth/v1/admin/users/"));
    expect(authDeletes.sort()).toEqual(["DELETE /auth/v1/admin/users/t1", "DELETE /auth/v1/admin/users/t3"]);
    const restDeletes = calls.filter((c) => c.startsWith("DELETE /rest/v1/"));
    expect(restDeletes.length).toBeGreaterThan(0);
    for (const c of restDeletes) {
      expect(c).not.toContain("like.");
      expect(c).not.toContain("oab-test+x@");
      expect(c).toMatch(/email=eq\.oab-test\+[0-9a-f-]{36}@example\.test$/);
    }
    for (const table of ["invited_emails", "access_requests"]) expect(restDeletes).toContain(`DELETE /rest/v1/${table}?email=eq.${other}`);
    const likes = calls.filter((c) => c.includes("like."));
    for (const c of likes) expect(c).toContain(`like.${INTEGRATION_EMAIL_PATTERN}`);
    expect(calls.some((c) => c.includes("gmail") || c.includes("oab-e2e") || c.includes("/e1"))).toBe(false);
  });

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
