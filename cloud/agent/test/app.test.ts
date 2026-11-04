import { describe, expect, it, vi } from "vitest";
import { makeHostedApp } from "./fixtures/hostedApp.js";
import { ADMIN, ALICE, BOB, CHAT_1 } from "./fixtures/users.js";

const USER_ROUTES: Array<[string, string]> = [
  ["POST", "/agui"],
  ["GET", "/chats"],
  ["GET", `/chats/${CHAT_1}/messages`],
  ["GET", "/profile"],
  ["PUT", "/profile"],
  ["GET", "/settings"],
  ["POST", "/settings/brave-search/key"],
  ["GET", "/places?q=555"],
  ["GET", "/onboarding/options"],
  ["GET", "/models"],
  ["GET", "/providers"],
  ["POST", "/providers/groq/key"],
  ["DELETE", "/providers/groq"],
  ["GET", "/artifacts/abcdefghijkl"],
];

describe("createApp guards", () => {
  it("answers signed_out with a bearer challenge when the token is missing or wrong", async () => {
    const { call } = await makeHostedApp();
    for (const [method, path] of USER_ROUTES) {
      const res = await call(null, path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
      expect(await res.json()).toMatchObject({ error: "signed_out" });
    }
    expect((await call(null, "/profile", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("refuses a deactivated user with 403 account_disabled", async () => {
    const { call, accounts } = await makeHostedApp();
    accounts.users.get(ALICE.id)!.status = "deactivated";
    const res = await call(ALICE, "/profile");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "account_disabled" });
  });

  it("fails closed with 503 when the status lookup is down", async () => {
    const { call, accounts } = await makeHostedApp();
    vi.spyOn(accounts, "repo").mockImplementation(() => {
      throw new Error("db down");
    });
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call(BOB, "/profile");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "auth_unavailable" });
    quiet.mockRestore();
  });

  it("hides admin routes from non-admins behind a 404", async () => {
    const { call } = await makeHostedApp();
    for (const path of ["/admin/users", "/admin/access-requests"]) {
      const res = await call(ALICE, path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
    expect((await call(ADMIN, "/admin/users")).status).toBe(200);
  });
});
