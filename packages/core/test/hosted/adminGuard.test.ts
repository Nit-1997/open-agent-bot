import { describe, it } from "vitest";

describe("createAdminGuard", () => {
  it.todo("lets a live admin through with the principal on the context");
  it.todo("answers 404 without a live check when the token doesn't claim admin");
  it.todo("answers 404 when the live check says no");
  it.todo("answers 503 auth_unavailable when the live check throws");
  it.todo("renders the authentication error verbatim");
});
