import { describe, it } from "vitest";

describe("createSupabaseIdentity", () => {
  it.todo("is the hosted identity");
  it.todo("admits a caller with the service secret");
  it.todo("refuses a wrong, short or missing secret even with a valid bearer, without verifying it");
  it.todo("maps a VerifiedUser to a Principal without the sessionId");
  it.todo("passes the bearer token to the verifier and checks the account status");
  it.todo("answers signed_out for a missing, malformed, invalid or expired bearer");
  it.todo("answers auth_unavailable when the key set can't be fetched or the status lookup fails");
  it.todo("answers account_disabled for a deactivated or unknown account");
});

describe("serviceSecretMatches", () => {
  it.todo("compares in constant time and rejects missing, short and wrong values");
});
