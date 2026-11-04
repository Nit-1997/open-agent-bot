import { afterAll, describe, expect, it } from "vitest";
import { anon, cleanedEmails, createTestUser, deleteCreatedUsers, enabled, remainingRows, service, testEmail, track } from "./helpers.js";

describe.skipIf(!enabled)("sign-up gates (live project)", () => {
  afterAll(async () => {
    expect(await remainingRows(cleanedEmails(await deleteCreatedUsers()))).toBe(0);
  }, 60_000);

  it("records that admin createUser bypasses the hook, so only trusted scripts may call it", async () => {
    const email = testEmail();
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (data.user) track(data.user.id, email);
    expect({ created: !!data.user, error: error?.message ?? null }).toEqual({ created: true, error: null });
  });

  it("rejects admin generateLink(invite) for an email that isn't invited", async () => {
    const { error } = await service().auth.admin.generateLink({ type: "invite", email: testEmail() });
    expect(error?.message).toMatch(/invite-only/);
  });

  it("allows an invited email", async () => {
    const user = await createTestUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses public OTP sign-up even when the client asks to create the user", async () => {
    const { error } = await anon().auth.signInWithOtp({ email: testEmail(), options: { shouldCreateUser: true } });
    expect(error).not.toBeNull();
    expect(error?.code ?? error?.message).toMatch(/signup_disabled|not allowed|disabled/i);
  });
});
