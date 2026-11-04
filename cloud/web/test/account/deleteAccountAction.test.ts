import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteOwnAccount } from "@/app/account/actions";
import { callAgent } from "@/lib/agentCall";
import { dropSessionCookies } from "@/lib/supabase/session";

vi.mock("@/lib/supabase/session", () => ({ dropSessionCookies: vi.fn(async () => {}) }));
vi.mock("@/lib/agentCall", async (orig) => ({
  ...(await orig<typeof import("@/lib/agentCall")>()),
  callAgent: vi.fn(async () => ({ ok: true, data: { ok: true } })),
  withAgentAuth: vi.fn((fn: (auth: unknown) => unknown) => fn({ accessToken: "t" })),
}));

beforeEach(() => vi.clearAllMocks());

describe("deleteOwnAccount", () => {
  it("posts only the typed email to the agent's /account/delete and drops the session cookies on success", async () => {
    expect(await deleteOwnAccount("  me@example.test ")).toEqual({ ok: true, data: { ok: true } });
    expect(vi.mocked(callAgent).mock.calls).toEqual([
      [
        "/account/delete",
        { accessToken: "t" },
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmEmail: "me@example.test" }) },
      ],
    ]);
    expect(dropSessionCookies).toHaveBeenCalledTimes(1);
  });

  it("keeps the session and passes the agent's refusal through", async () => {
    const refusal = { ok: false as const, status: 409, error: "admin_self_delete", message: "Admins can't delete their own account here." };
    vi.mocked(callAgent).mockResolvedValueOnce(refusal);
    expect(await deleteOwnAccount("admin@example.test")).toEqual(refusal);
    expect(dropSessionCookies).not.toHaveBeenCalled();
  });

  it.each([undefined, 7, "", "   ", "x".repeat(321)])("refuses %s without calling the agent", async (typed) => {
    expect(await deleteOwnAccount(typed)).toMatchObject({ ok: false, status: 400, error: "invalid" });
    expect(callAgent).not.toHaveBeenCalled();
    expect(dropSessionCookies).not.toHaveBeenCalled();
  });
});
