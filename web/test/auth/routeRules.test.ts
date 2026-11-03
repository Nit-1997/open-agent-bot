import { describe, expect, it } from "vitest";
import { decideRoute } from "@/lib/routeRules";

const user = { user: { id: "u1", email: "a@b.c", name: "", isAdmin: false }, unavailable: false };
const admin = { user: { id: "u2", email: "admin@b.c", name: "", isAdmin: true }, unavailable: false };
const none = { user: null, unavailable: false };
const down = { user: null, unavailable: true };

describe("decideRoute", () => {
  it("lets anyone reach the sign-in pages", () => {
    for (const path of ["/login", "/request-access", "/auth/callback", "/auth/confirm", "/auth/signout", "/landing", "/_next/data/x"]) {
      expect(decideRoute(path, none)).toEqual({ kind: "pass" });
    }
  });

  it("shows signed-out visitors the landing page at / and the app once signed in", () => {
    expect(decideRoute("/", none)).toEqual({ kind: "landing" });
    expect(decideRoute("/", down)).toEqual({ kind: "landing" });
    expect(decideRoute("/", user)).toEqual({ kind: "pass" });
  });

  it("sends signed-out visitors to /login and answers 401 on the API", () => {
    expect(decideRoute("/chats", none)).toEqual({ kind: "login" });
    expect(decideRoute("/api/profile", none)).toEqual({ kind: "json", status: 401, error: "signed_out" });
  });

  it("fails closed when the account service is down", () => {
    expect(decideRoute("/chats", down)).toEqual({ kind: "login", error: "auth_unavailable" });
    expect(decideRoute("/api/profile", down)).toEqual({ kind: "json", status: 503, error: "auth_unavailable" });
  });

  it("hides admin routes from non-admins", () => {
    expect(decideRoute("/admin", user)).toEqual({ kind: "not_found_page" });
    expect(decideRoute("/admin/users", user)).toEqual({ kind: "not_found_page" });
    expect(decideRoute("/admin", admin)).toEqual({ kind: "pass" });
    expect(decideRoute("/administrator", user)).toEqual(decideRoute("/administrator", admin));
  });

  it("gives signed-in users the not-found page for every unknown page", () => {
    const unknown = ["/nope", "/nope/deeper", "/chats/not-a-uuid", "/reports/BAD!", "/administrator", "/search/x", "/__not-found"];
    for (const path of unknown) {
      expect(decideRoute(path, user)).toEqual({ kind: "not_found_page" });
      expect(decideRoute(path, admin)).toEqual({ kind: "not_found_page" });
    }
    expect(decideRoute("/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extra", user)).toEqual({ kind: "not_found_page" });
    expect(decideRoute("/reports/AbCdEf_-1234/x", user)).toEqual({ kind: "not_found_page" });
    expect(decideRoute("/admin/users", admin)).toEqual({ kind: "not_found_page" });
  });

  it("lets signed-in users reach every app page", () => {
    const pages = [
      "/",
      "/chats",
      "/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "/chats/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      "/reports",
      "/reports/AbCdEf_-1234",
      "/search",
    ];
    for (const path of pages) {
      expect(decideRoute(path, user)).toEqual({ kind: "pass" });
      expect(decideRoute(path, admin)).toEqual({ kind: "pass" });
    }
    expect(decideRoute("/admin", admin)).toEqual({ kind: "pass" });
  });

  it("leaves the API and the public pages to their own handlers when signed in", () => {
    for (const path of ["/api/chats", "/api/nope", "/api", "/login", "/landing", "/auth/signout", "/_next/static/x.js"]) {
      expect(decideRoute(path, user)).toEqual({ kind: "pass" });
    }
  });

  it("still sends signed-out visitors of an unknown page to /login", () => {
    for (const path of ["/nope", "/nope/deeper", "/chats/not-a-uuid", "/admin"]) {
      expect(decideRoute(path, none)).toEqual({ kind: "login" });
    }
  });
});
