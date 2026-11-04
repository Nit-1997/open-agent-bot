import { describe, expect, it } from "vitest";
import { describeInviteFailure } from "../../../src/hosted/admin/inviteCopy.js";

describe("describeInviteFailure", () => {
  it.each([
    ["http_500", "The email service didn't accept the invite."],
    ["unexpected_failure", "The email service didn't accept the invite."],
    ["over_email_send_rate_limit", "Too many emails were sent recently."],
    ["http_429", "Too many emails were sent recently."],
    ["email_address_invalid", "The email provider rejected this address."],
    ["email_address_not_authorized", "only allows test addresses"],
    ["unreachable", "Couldn't reach the sign-in service."],
    ["something_new", "The invite email couldn't be sent."],
  ])("explains %s in plain words and keeps the code", (code, text) => {
    const copy = describeInviteFailure(code);
    expect(copy).toContain(text);
    expect(copy.endsWith(`(${code})`)).toBe(true);
  });
});
