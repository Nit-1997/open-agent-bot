import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "../../src/lib/apiErrors.ts";
import { AUTH_ERROR_COPY, authErrorCopy, callbackErrorCode } from "../../src/lib/authErrors.ts";

describe("login error copy", () => {
  it("maps every known code to its copy", () => {
    for (const [code, copy] of Object.entries(AUTH_ERROR_COPY)) expect(authErrorCopy(code)).toBe(copy);
  });

  it("shows nothing for unknown or inherited values", () => {
    expect(authErrorCopy("Something bad <script>")).toBeNull();
    expect(authErrorCopy("toString")).toBeNull();
    expect(authErrorCopy(undefined)).toBeNull();
    expect(authErrorCopy(["not_invited"])).toBeNull();
  });
});

describe("callbackErrorCode", () => {
  const params = (q: string) => new URLSearchParams(q);

  it("maps disabled sign-ups and the hook's message to not_invited", () => {
    expect(callbackErrorCode(params("error=access_denied&error_code=signup_disabled"))).toBe("not_invited");
    expect(callbackErrorCode(params("error=server_error&error_description=Open+Agent+is+invite-only.+Request+access+first."))).toBe(
      "not_invited",
    );
  });

  it("maps any other error to auth_failed", () => {
    expect(callbackErrorCode(params("error=access_denied&error_description=User+cancelled"))).toBe("auth_failed");
    expect(callbackErrorCode(params("error_code=bad_oauth_state"))).toBe("auth_failed");
  });

  it("returns null without an error", () => {
    expect(callbackErrorCode(params("code=abc"))).toBeNull();
  });
});

describe("apiErrorMessage", () => {
  it("prefers the agent's message, then known copy, then the code", () => {
    expect(apiErrorMessage(409, { error: "already_member", message: "This email already has an account." })).toBe(
      "This email already has an account.",
    );
    expect(apiErrorMessage(401, { error: "signed_out" })).toBe(AUTH_ERROR_COPY.signed_out);
    expect(apiErrorMessage(409, { error: "version_conflict" })).toBe("version_conflict");
    expect(apiErrorMessage(500, {})).toBe("Request failed (500).");
  });

  it("tells the user how long to wait on 429", () => {
    expect(apiErrorMessage(429, { error: "rate_limited", retryAfter: 42 })).toBe("Slow down: try again in 42 s.");
  });

  it("names the failed delete step", () => {
    expect(apiErrorMessage(500, { error: "delete_failed", message: "Delete failed.", step: "storage" })).toBe(
      "Delete failed. (step: storage)",
    );
  });
});
