import { describe, expect, it } from "vitest";
import { pathCovered, USER_PATHS } from "../../src/identity/userPaths.js";

describe("pathCovered", () => {
  it("covers every user path and anything under the wildcard ones", () => {
    for (const p of USER_PATHS) expect(pathCovered(p), p).toBe(true);
    for (const p of ["/chats/x", "/chats/x/messages", "/providers/a/b", "/onboarding", "/onboarding/options", "/reports/1"]) {
      expect(pathCovered(p), p).toBe(true);
    }
  });

  it("treats wildcards and parameters that could reach a user path as covered", () => {
    for (const p of ["*", "/*", "/:id", "/:a/:b", "/:id?", "/chats/:id", "/:x/*", "/chat*"]) expect(pathCovered(p), p).toBe(true);
  });

  it("leaves unrelated paths alone", () => {
    for (const p of [
      "/",
      "/access-requests",
      "/auth/email-link",
      "/admin",
      "/admin/*",
      "/chatsx",
      "/health",
      "/agui/x",
      "/search/x",
      "/x/:id",
    ]) {
      expect(pathCovered(p), p).toBe(false);
    }
  });
});
