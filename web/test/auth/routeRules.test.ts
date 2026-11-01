import { describe, expect, it } from "vitest";
import { decideRoute } from "@/lib/routeRules";

const user = { user: { id: "u1", email: "a@b.c", name: "", isAdmin: false }, unavailable: false };
const admin = { user: { id: "u2", email: "admin@b.c", name: "", isAdmin: true }, unavailable: false };
const none = { user: null, unavailable: false };
const down = { user: null, unavailable: true };

describe("decideRoute", () => {
  it("lets anyone reach the sign-in pages", () => {
    for (const path of ["/login", "/request-access", "/auth/callback", "/auth/confirm", "/auth/signout", "/_next/data/x"]) {
      expect(decideRoute(path, none)).toEqual({ kind: "pass" });
    }
  });

  it("sends signed-out visitors to /login and answers 401 on the API", () => {
    expect(decideRoute("/", none)).toEqual({ kind: "login" });
    expect(decideRoute("/api/profile", none)).toEqual({ kind: "json", status: 401, error: "signed_out" });
  });

  it("fails closed when the account service is down", () => {
    expect(decideRoute("/", down)).toEqual({ kind: "login", error: "auth_unavailable" });
    expect(decideRoute("/api/profile", down)).toEqual({ kind: "json", status: 503, error: "auth_unavailable" });
  });

  it("hides admin routes from non-admins", () => {
    expect(decideRoute("/admin", user)).toEqual({ kind: "not_found_page" });
    expect(decideRoute("/admin", admin)).toEqual({ kind: "pass" });
    expect(decideRoute("/administrator", user)).toEqual({ kind: "pass" });
  });
});
