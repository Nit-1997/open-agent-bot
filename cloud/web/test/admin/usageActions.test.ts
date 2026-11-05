import { beforeEach, describe, expect, it, vi } from "vitest";
import { listUsage, usageDetail, usageSummary } from "@/app/admin/actions";
import { callAgent } from "@/lib/agentCall";
import { getClaimsOrNull } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ getClaimsOrNull: vi.fn() }));
vi.mock("@/lib/agentCall", () => ({
  callAgent: vi.fn(async () => ({ ok: true, data: {} })),
  jsonBody: vi.fn(),
  withAgentAuth: vi.fn((fn: (auth: unknown) => unknown) => fn({ token: "t" })),
}));

const ID = "00000000-0000-4000-8000-000000000001";
const admin = { id: ID, email: "a@example.test", isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClaimsOrNull).mockResolvedValue(admin as Awaited<ReturnType<typeof getClaimsOrNull>>);
});

const paths = () => vi.mocked(callAgent).mock.calls.map((c) => c[0]);

describe("admin usage actions", () => {
  it("call the agent's admin usage routes with validated params", async () => {
    await usageSummary();
    await listUsage(1, "", "all");
    await listUsage(3, "  Priya&x=1 ", "at_limit");
    await usageDetail(ID.toUpperCase());
    expect(paths()).toEqual([
      "/admin/usage/summary",
      "/admin/usage/users?page=1&filter=all",
      "/admin/usage/users?page=3&filter=at_limit&q=Priya%26x%3D1",
      `/admin/usage/users/${ID}`,
    ]);
  });

  it.each([
    [0, "", "all"],
    [10_001, "", "all"],
    ["1.5", "", "all"],
    [1, "", "bogus"],
    [1, "", undefined],
    [1, "x".repeat(101), "all"],
  ])("refuses page=%s q=%s filter=%s without calling the agent", async (page, q, filter) => {
    expect(await listUsage(page, q, filter)).toMatchObject({ ok: false, status: 400, error: "invalid" });
    expect(callAgent).not.toHaveBeenCalled();
  });

  it("refuses a non-uuid detail id and hides everything from non-admins", async () => {
    expect(await usageDetail("../users")).toMatchObject({ ok: false, status: 400 });
    vi.mocked(getClaimsOrNull).mockResolvedValue({ ...admin, isAdmin: false } as Awaited<ReturnType<typeof getClaimsOrNull>>);
    for (const r of [await usageSummary(), await listUsage(1, "", "all"), await usageDetail(ID)])
      expect(r).toMatchObject({ ok: false, status: 404, error: "not_found" });
    expect(callAgent).not.toHaveBeenCalled();
  });
});
