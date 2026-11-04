import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listUsage, listUsers, usageDetail, usageSummary } from "@/app/admin/actions";
import { AdminView } from "@/components/admin/AdminView";
import { UsageTab } from "@/components/admin/UsageTab";
import type { ActionResult } from "@/lib/actionResult";
import type { AdminUser } from "@oab/shared/admin";
import type { PageResponse } from "@oab/shared/pages";
import type { AdminUsageDetail, AdminUsageRow, AdminUsageSummary } from "@oab/shared/usage";
import { formatWhen } from "@oab/ui/lib/chats.ts";

vi.mock("@/app/admin/actions", () => ({
  listRequests: vi.fn(),
  decideRequest: vi.fn(),
  listUsers: vi.fn(),
  setUserStatus: vi.fn(),
  deleteUser: vi.fn(),
  usageSummary: vi.fn(),
  listUsage: vi.fn(),
  usageDetail: vi.fn(),
}));

const NOW = Date.parse("2026-11-04T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const row = (n: number, over: Partial<AdminUsageRow> = {}): AdminUsageRow => ({
  id: uuid(n),
  email: `user${n}@example.test`,
  monthUsed: 50 - n,
  monthLimit: 50,
  lastAt: new Date(NOW - n * 3_600_000).toISOString(),
  runningNow: false,
  ...over,
});

const pageOf = <T,>(items: T[], page: number, total: number): ActionResult<PageResponse<T>> => ({
  ok: true,
  data: { items, total, page, pageSize: 5 },
});
const fail = (status: number, error: string, message: string) => ({ ok: false as const, status, error, message });

const SUMMARY: AdminUsageSummary = {
  month: { total: 1284, activeUsers: 41, resetsAt: "2026-12-01T00:00:00.000Z" },
  running: { now: 3, limit: 8, staleReleased: 0 },
  limits: { runningPerUser: 1, perHour: 10, perMonth: 50, runningServer: 8 },
  signupMode: "waitlist",
  signups: null,
};
const summaryOk = (over: Partial<AdminUsageSummary> = {}): ActionResult<AdminUsageSummary> => ({ ok: true, data: { ...SUMMARY, ...over } });

const DETAIL: AdminUsageDetail = {
  id: uuid(1),
  email: "user1@example.test",
  status: "active",
  month: { used: 49, limit: 50, resetsAt: "2026-12-01T00:00:00.000Z" },
  hour: { used: 3, limit: 10, resetsAt: new Date(NOW + 12 * 60_000).toISOString() },
  running: { now: 1, limit: 1 },
  lastAt: new Date(NOW - 3_600_000).toISOString(),
};

const first = pageOf(
  [1, 2, 3, 4, 5].map((n) => row(n, { runningNow: n === 2 })),
  1,
  41,
);

const expectUniqueIds = (root: HTMLElement) => {
  const ids = [...root.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
  expect(ids.filter((id) => !id)).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
};

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const text = (id: string) => byId(id)?.textContent;

const renderTab = (over: Partial<Parameters<typeof UsageTab>[0]> = {}) =>
  render(<UsageTab summary={summaryOk()} users={first} onOpenUser={vi.fn()} {...over} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("UsageTab totals", () => {
  it("shows the month totals, running now, the limits and the signup mode, read-only", () => {
    const { container } = renderTab();
    expect(text("admin-usage-month-total")).toBe("Requests this month 1,284");
    expect(text("admin-usage-active-users")).toBe("Active users 41");
    expect(text("admin-usage-running")).toBe("Running now 3 / 8");
    expect(text("admin-usage-limits")).toBe("1 running per user · 10 per hour · 50 per month · 8 running on the server");
    expect(text("admin-usage-signup-mode")).toBe("Signups: waitlist · Changed by the owner with configure-auth");
    expect(byId("admin-usage-signup-mode").className).not.toContain("text-warn-fg");
    expect(byId("admin-usage-signups")).toBeNull();
    expect(container.querySelectorAll("#admin-usage-totals input, #admin-usage-totals select")).toHaveLength(0);
    expectUniqueIds(container);
  });

  it("shows the signup counts once they exist and an unknown mode in the warn colour", () => {
    renderTab({ summary: summaryOk({ signupMode: "unknown", signups: { lastHour: 4, lastDay: 31, capHour: 20, capDay: 100 } }) });
    expect(text("admin-usage-signups")).toBe("New accounts: 4 in the last hour (cap 20) · 31 today (cap 100)");
    expect(text("admin-usage-signup-mode")).toBe("Signups: unknown · Changed by the owner with configure-auth");
    expect(byId("admin-usage-signup-mode").className).toContain("text-warn-fg");
  });

  it("explains a failed totals load and retries", async () => {
    vi.mocked(usageSummary).mockResolvedValue(summaryOk());
    const { container } = renderTab({ summary: fail(503, "usage_unavailable", "Can't load usage right now. Try again in a minute.") });
    expect(text("admin-usage-totals-error-text")).toBe("Couldn't load the totals: Can't load usage right now. Try again in a minute.");
    expect(byId("admin-usage-month-total")).toBeNull();
    expectUniqueIds(container);
    fireEvent.click(byId("admin-usage-totals-retry"));
    await waitFor(() => expect(text("admin-usage-month-total")).toBe("Requests this month 1,284"));
  });

  it("refreshes the totals and the current page", async () => {
    vi.mocked(usageSummary).mockResolvedValue(summaryOk({ running: { now: 5, limit: 8, staleReleased: 0 } }));
    vi.mocked(listUsage).mockResolvedValue(first);
    renderTab();
    fireEvent.click(byId("admin-usage-refresh"));
    await waitFor(() => expect(text("admin-usage-running")).toBe("Running now 5 / 8"));
    expect(listUsage).toHaveBeenCalledWith(1, "", "all");
  });
});

describe("UsageTab list", () => {
  it("shows 5 per page, newest first, with the range, the page number and row details", () => {
    const { container } = renderTab();
    expect(text("admin-usage-count")).toBe("Showing 1–5 of 41 · newest first · 5 per page");
    expect(text("admin-usage-page")).toBe("Page 1 of 9");
    expect(byId("admin-usage-prev")).toBeDisabled();
    expect(byId("admin-usage-next")).toBeEnabled();
    const rows = within(byId("admin-usage-list")).getAllByRole("listitem");
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5].map((n) => `admin-usage-row-${uuid(n)}`));
    const r1 = `admin-usage-row-${uuid(1)}`;
    expect(text(`${r1}-email`)).toBe("user1@example.test");
    expect(text(`${r1}-used`)).toBe("49 / 50");
    expect(text(`${r1}-last`)).toBe("1 h ago");
    expect(byId(`${r1}-last`)).toHaveAttribute("title", formatWhen(row(1).lastAt));
    expect(byId(`${r1}-running`)).toBeNull();
    expect(byId(`admin-usage-row-${uuid(2)}-running`)).toHaveAttribute("aria-label", "Running now");
    expect(byId(`${r1}-view`)).toHaveTextContent("View");
    expect(byId(`${r1}-select`)).toHaveTextContent("Select");
    expectUniqueIds(container);
  });

  it("shows never for a row without a last request", () => {
    renderTab({ users: pageOf([row(1, { lastAt: null })], 1, 1) });
    expect(text(`admin-usage-row-${uuid(1)}-last`)).toBe("never");
  });

  it("pages forward and back", async () => {
    vi.mocked(listUsage).mockResolvedValueOnce(
      pageOf(
        [6, 7, 8, 9, 10].map((n) => row(n)),
        2,
        41,
      ),
    );
    renderTab();
    fireEvent.click(byId("admin-usage-next"));
    await waitFor(() => expect(text("admin-usage-count")).toBe("Showing 6–10 of 41 · newest first · 5 per page"));
    expect(text("admin-usage-page")).toBe("Page 2 of 9");
    expect(listUsage).toHaveBeenLastCalledWith(2, "", "all");
    vi.mocked(listUsage).mockResolvedValueOnce(first);
    fireEvent.click(byId("admin-usage-prev"));
    await waitFor(() => expect(text("admin-usage-page")).toBe("Page 1 of 9"));
    expect(listUsage).toHaveBeenLastCalledWith(1, "", "all");
  });

  it("steps back to the last page when a page comes back empty, using the total", async () => {
    vi.mocked(listUsage)
      .mockResolvedValueOnce(pageOf<AdminUsageRow>([], 2, 5))
      .mockResolvedValueOnce(
        pageOf(
          [1, 2, 3, 4, 5].map((n) => row(n)),
          1,
          5,
        ),
      );
    renderTab();
    fireEvent.click(byId("admin-usage-next"));
    await waitFor(() => expect(text("admin-usage-page")).toBe("Page 1 of 1"));
    expect(vi.mocked(listUsage).mock.calls).toEqual([
      [2, "", "all"],
      [1, "", "all"],
    ]);
    expect(text("admin-usage-count")).toBe("Showing 1–5 of 5 · newest first · 5 per page");
  });

  it("searches email contains on the server after 300 ms, once per pause", async () => {
    vi.useRealTimers();
    vi.mocked(listUsage).mockResolvedValue(pageOf([row(7, { email: "priya@example.test" })], 1, 1));
    renderTab();
    for (const v of ["p", "pr", "priya "]) fireEvent.change(byId("admin-usage-search"), { target: { value: v } });
    await new Promise((r) => setTimeout(r, 200));
    expect(listUsage).not.toHaveBeenCalled();
    await waitFor(() => expect(listUsage).toHaveBeenCalledWith(1, "priya", "all"));
    await waitFor(() => expect(text("admin-usage-count")).toBe("Showing 1–1 of 1 · newest first · 5 per page"));
    await new Promise((r) => setTimeout(r, 400));
    expect(listUsage).toHaveBeenCalledTimes(1);
  });

  it("filters at the limit on the server and explains an empty filtered list", async () => {
    vi.mocked(listUsage).mockResolvedValue(pageOf<AdminUsageRow>([], 1, 0));
    renderTab();
    expect(byId("admin-usage-filter")).toHaveValue("all");
    fireEvent.change(byId("admin-usage-filter"), { target: { value: "at_limit" } });
    await waitFor(() => expect(text("admin-usage-empty")).toBe("No users match these filters."));
    expect(listUsage).toHaveBeenCalledWith(1, "", "at_limit");
    expect(byId("admin-usage-list")).toBeNull();
  });

  it("shows the empty state for a month without requests", () => {
    const { container } = renderTab({ users: pageOf<AdminUsageRow>([], 1, 0) });
    expect(text("admin-usage-empty")).toBe("No requests this month yet.");
    expect(byId("admin-usage-pager")).toBeNull();
    expectUniqueIds(container);
  });

  it("shows the server message on a failed load with a retry", async () => {
    vi.mocked(listUsage).mockResolvedValue(first);
    const { container } = renderTab({ users: fail(503, "usage_unavailable", "Can't load usage right now. Try again in a minute.") });
    expect(byId("admin-usage-error")).toHaveAttribute("role", "alert");
    expect(text("admin-usage-error-text")).toBe("Couldn't load usage: Can't load usage right now. Try again in a minute.");
    expectUniqueIds(container);
    fireEvent.click(byId("admin-usage-retry"));
    await waitFor(() => expect(text("admin-usage-page")).toBe("Page 1 of 9"));
    expect(byId("admin-usage-error")).toBeNull();
  });
});

describe("UsageTab View and Select", () => {
  it("View loads the detail from the server and collapses again", async () => {
    vi.mocked(usageDetail).mockResolvedValue({ ok: true, data: DETAIL });
    const { container } = renderTab();
    const view = byId(`admin-usage-row-${uuid(1)}-view`);
    fireEvent.click(view);
    expect(view).toHaveAttribute("aria-expanded", "true");
    expect(usageDetail).toHaveBeenCalledWith(uuid(1));
    const d = `admin-usage-detail-${uuid(1)}`;
    await waitFor(() => expect(text(`${d}-list-status-value`)).toBe("active"));
    expect(text(`${d}-list-month-value`)).toBe("49 / 50 · resets 1 Dec");
    expect(text(`${d}-list-hour-value`)).toBe("3 / 10 · resets in 12 min");
    expect(text(`${d}-list-running-value`)).toBe("1 of 1");
    expect(text(`${d}-list-last-value`)).toBe(`1 h ago (${formatWhen(DETAIL.lastAt)})`);
    expectUniqueIds(container);
    fireEvent.click(view);
    expect(byId(d)).toBeNull();
    expect(view).toHaveAttribute("aria-expanded", "false");
  });

  it("shows an hour without requests and a user who isn't running", async () => {
    vi.mocked(usageDetail).mockResolvedValue({
      ok: true,
      data: { ...DETAIL, hour: { used: 0, limit: 10, resetsAt: null }, running: { now: 0, limit: 1 }, lastAt: null, status: "deactivated" },
    });
    renderTab();
    fireEvent.click(byId(`admin-usage-row-${uuid(1)}-view`));
    const d = `admin-usage-detail-${uuid(1)}-list`;
    await waitFor(() => expect(text(`${d}-hour-value`)).toBe("0 / 10"));
    expect(text(`${d}-running-value`)).toBe("no");
    expect(text(`${d}-last-value`)).toBe("never");
    expect(text(`${d}-status-value`)).toBe("deactivated");
  });

  it("explains a failed detail load and retries", async () => {
    vi.mocked(usageDetail)
      .mockResolvedValueOnce(fail(404, "not_found", "That user doesn't exist."))
      .mockResolvedValueOnce({ ok: true, data: DETAIL });
    const { container } = renderTab();
    fireEvent.click(byId(`admin-usage-row-${uuid(1)}-view`));
    const d = `admin-usage-detail-${uuid(1)}`;
    await waitFor(() => expect(text(`${d}-error-text`)).toBe("Couldn't load this user: That user doesn't exist."));
    expectUniqueIds(container);
    fireEvent.click(byId(`${d}-retry`));
    await waitFor(() => expect(text(`${d}-list-status-value`)).toBe("active"));
  });

  it("selects one row at a time, shows the selection and opens the user in the Users tab", () => {
    const onOpenUser = vi.fn();
    const { container } = renderTab({ onOpenUser });
    expect(byId("admin-usage-selection")).toBeNull();
    const s1 = byId(`admin-usage-row-${uuid(1)}-select`);
    const s3 = byId(`admin-usage-row-${uuid(3)}-select`);
    expect(s1).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(s1);
    expect(s1).toHaveAttribute("aria-pressed", "true");
    expect(text("admin-usage-selection-text")).toBe("Selected: user1@example.test");
    fireEvent.click(s3);
    expect(s1).toHaveAttribute("aria-pressed", "false");
    expect(s3).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(text("admin-usage-selection-text")).toBe("Selected: user3@example.test");
    expectUniqueIds(container);
    fireEvent.click(byId("admin-usage-open-user"));
    expect(onOpenUser).toHaveBeenCalledWith("user3@example.test");
    fireEvent.click(s3);
    expect(byId("admin-usage-selection")).toBeNull();
  });

  it("clears the selection on a page change", async () => {
    vi.mocked(listUsage).mockResolvedValue(
      pageOf(
        [6, 7].map((n) => row(n)),
        2,
        7,
      ),
    );
    renderTab({
      users: pageOf(
        [1, 2, 3, 4, 5].map((n) => row(n)),
        1,
        7,
      ),
    });
    fireEvent.click(byId(`admin-usage-row-${uuid(2)}-select`));
    expect(byId("admin-usage-selection")).not.toBeNull();
    await act(async () => fireEvent.click(byId("admin-usage-next")));
    await waitFor(() => expect(text("admin-usage-page")).toBe("Page 2 of 2"));
    expect(byId("admin-usage-selection")).toBeNull();
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  });
});

describe("AdminView Usage tab", () => {
  const users = pageOf<AdminUser>([], 1, 0);

  it("adds a Usage tab and Open in Users switches tabs with the email searched", async () => {
    const found: AdminUser = {
      id: uuid(3),
      email: "user3@example.test",
      status: "active",
      createdAt: "2026-10-30T10:00:00Z",
      lastSignInAt: null,
      providers: ["google"],
      isAdmin: false,
    };
    vi.mocked(listUsers).mockResolvedValue(pageOf([found], 1, 1));
    const { container } = render(
      <AdminView
        email="admin@example.test"
        selfId={uuid(100)}
        requests={pageOf([], 1, 0)}
        users={users}
        usageSummary={summaryOk()}
        usage={first}
      />,
    );
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Requests", "Users", "Usage"]);
    fireEvent.click(byId("admin-tab-usage"));
    expect(byId("admin-panel-usage")).toBeVisible();
    expect(byId("admin-tab-usage")).toHaveAttribute("aria-controls", "admin-panel-usage");
    expectUniqueIds(container);
    fireEvent.click(byId(`admin-usage-row-${uuid(3)}-select`));
    fireEvent.click(byId("admin-usage-open-user"));
    await waitFor(() => expect(byId("admin-tab-users")).toHaveAttribute("aria-selected", "true"));
    expect(listUsers).toHaveBeenCalledWith(1, "user3@example.test");
    expect(byId("admin-users-search-input")).toHaveValue("user3@example.test");
    expect(byId(`admin-users-row-${uuid(3)}`)).toBeInTheDocument();
    expect(byId("admin-panel-usage")).not.toBeVisible();
    expectUniqueIds(container);
  });
});
