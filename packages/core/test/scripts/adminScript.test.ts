import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS owner script without type declarations
import { createAdmin } from "../../../supabase/scripts/admin.mjs";
import { DELETE_STEPS, type DeleteStep } from "../../src/admin/deleteAccount.js";
import { BOB } from "../fixtures/users.js";

const STEP_OF: Array<[RegExp, DeleteStep]> = [
  [/^(POST|DELETE) \/storage\/v1\/object\//, "storage"],
  [/^DELETE \/rest\/v1\/(access_requests|invited_emails)$/, "requests"],
  [/^DELETE \/auth\/v1\/admin\/users\//, "auth_user"],
];

afterEach(() => vi.unstubAllGlobals());

describe("supabase/scripts/admin.mjs deleteUser", () => {
  it("deletes in the same order as the agent's deleteAccount", async () => {
    const calls: Array<{ line: string; params: URLSearchParams; body: unknown }> = [];
    let listed = 0;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const line = `${init.method ?? "GET"} ${url.pathname}`;
      calls.push({ line, params: url.searchParams, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const body = line.includes("/object/list/") ? (listed++ === 0 ? [{ name: "a.html" }] : []) : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const admin = createAdmin({ url: "https://stub.supabase.test", key: "sb_secret_test" });
    await admin.deleteUser(BOB.id, BOB.email);

    expect(calls.map((c) => c.line)).toEqual([
      "POST /storage/v1/object/list/artifacts",
      "DELETE /storage/v1/object/artifacts",
      "POST /storage/v1/object/list/artifacts",
      "DELETE /rest/v1/access_requests",
      "DELETE /rest/v1/invited_emails",
      `DELETE /auth/v1/admin/users/${BOB.id}`,
    ]);
    expect(calls[0].body).toMatchObject({ prefix: BOB.id });
    expect(calls[1].body).toEqual({ prefixes: [`${BOB.id}/a.html`] });
    expect(calls[3].params.get("email")).toBe(`eq.${BOB.email}`);
    expect(calls[4].params.get("email")).toBe(`eq.${BOB.email}`);

    const steps = calls.map((c) => STEP_OF.find(([re]) => re.test(c.line))?.[1]);
    expect(steps.every(Boolean)).toBe(true);
    expect([...new Set(steps)]).toEqual([...DELETE_STEPS]);
  });
});
