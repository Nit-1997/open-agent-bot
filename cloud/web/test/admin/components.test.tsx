import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideRequest, deleteUser, listRequests, listUsers, setUserStatus } from "@/app/admin/actions";
import { AdminView } from "@/components/admin/AdminView";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { RequestsList } from "@/components/admin/RequestsList";
import { UsersList } from "@/components/admin/UsersList";
import type { ActionResult } from "@/lib/actionResult";
import type { AccessRequestView, AdminUser } from "@oab/shared/admin";
import type { PageResponse } from "@oab/shared/pages";

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

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const request = (n: number, over: Partial<AccessRequestView> = {}): AccessRequestView => ({
  id: uuid(n),
  name: `Person ${n}`,
  email: `person${n}@example.test`,
  note: n === 1 ? "testing" : "",
  status: "pending",
  inviteStatus: null,
  inviteError: null,
  ipHashPrefix: "a1b2c3d4",
  createdAt: "2026-10-31T10:00:00Z",
  decidedAt: null,
  ...over,
});

const user = (n: number, over: Partial<AdminUser> = {}): AdminUser => ({
  id: uuid(100 + n),
  email: `user${n}@example.test`,
  status: "active",
  createdAt: "2026-10-30T10:00:00Z",
  lastSignInAt: n === 1 ? null : "2026-10-31T09:00:00Z",
  providers: ["google"],
  isAdmin: n === 0,
  ...over,
});

const pageOf = <T,>(items: T[], page: number, total: number): ActionResult<PageResponse<T>> => ({
  ok: true,
  data: { items, total, page, pageSize: 5 },
});
const fail = (status: number, error: string, message: string) => ({ ok: false as const, status, error, message });

const expectUniqueIds = (root: HTMLElement) => {
  const ids = [...root.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
  expect(ids.filter((id) => !id)).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
};

const byId = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => vi.clearAllMocks());

describe("RequestsList", () => {
  const first = pageOf(
    [1, 2, 3, 4, 5].map((n) => request(n)),
    1,
    16,
  );

  it("shows 5 per page with the range, pages forward, and has unique ids", async () => {
    vi.mocked(listRequests).mockResolvedValue(
      pageOf(
        [6, 7, 8, 9, 10].map((n) => request(n)),
        2,
        16,
      ),
    );
    const { container } = render(<RequestsList initial={first} />);
    expect(screen.getByText("Showing 1–5 of 16")).toBeInTheDocument();
    fireEvent.click(byId(`admin-requests-view-${uuid(1)}`));
    expect(within(byId(`admin-requests-details-${uuid(1)}`)).getByText("a1b2c3d4")).toBeInTheDocument();
    expectUniqueIds(container);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Showing 6–10 of 16")).toBeInTheDocument();
    expect(listRequests).toHaveBeenCalledWith("pending", 2);
  });

  it("filters by status and shows the empty state", async () => {
    vi.mocked(listRequests).mockResolvedValue(pageOf([], 1, 0));
    render(<RequestsList initial={first} />);
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    expect(await screen.findByText("No rejected requests.")).toBeInTheDocument();
    expect(listRequests).toHaveBeenCalledWith("rejected", 1);
    expect(screen.getByRole("button", { name: "Rejected" })).toHaveAttribute("aria-pressed", "true");
  });

  it("approves, confirms, and reloads the list", async () => {
    vi.mocked(decideRequest).mockResolvedValue({ ok: true, data: { request: request(1, { status: "approved", inviteStatus: "sent" }) } });
    vi.mocked(listRequests).mockResolvedValue(
      pageOf(
        [2, 3, 4, 5, 6].map((n) => request(n)),
        1,
        15,
      ),
    );
    render(<RequestsList initial={first} />);
    fireEvent.click(byId(`admin-requests-approve-${uuid(1)}`));
    expect(await screen.findByRole("status")).toHaveTextContent("Approved person1@example.test. Invite sent.");
    expect(decideRequest).toHaveBeenCalledWith(uuid(1), "approve");
    expect(await screen.findByText("Showing 1–5 of 15")).toBeInTheDocument();
  });

  it("never makes a failed invite look successful, and still reloads", async () => {
    const message = "Invite email failed: over_email_send_rate_limit. Use Resend invite.";
    vi.mocked(decideRequest).mockResolvedValue(fail(502, "invite_failed", message));
    vi.mocked(listRequests).mockResolvedValue(
      pageOf(
        [2, 3, 4, 5, 6].map((n) => request(n)),
        1,
        15,
      ),
    );
    const { container } = render(<RequestsList initial={first} />);
    fireEvent.click(byId(`admin-requests-approve-${uuid(1)}`));
    expect(await screen.findByRole("alert")).toHaveTextContent(`person1@example.test: ${message}`);
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(listRequests).toHaveBeenCalled());
    expectUniqueIds(container);
  });

  it("shows a conflict on the row and reloads so the list shows the request's real state", async () => {
    vi.mocked(decideRequest).mockResolvedValue(fail(409, "already_decided", "This request was already decided."));
    vi.mocked(listRequests).mockResolvedValue(first);
    render(<RequestsList initial={first} />);
    fireEvent.click(byId(`admin-requests-approve-${uuid(2)}`));
    expect(await screen.findByRole("alert")).toHaveAttribute("id", `admin-requests-row-error-${uuid(2)}`);
    expect(byId(`admin-requests-row-error-${uuid(2)}`)).toHaveTextContent("This request was already decided.");
    await waitFor(() => expect(listRequests).toHaveBeenCalledWith("pending", 1));
  });

  it("explains an approval for someone who already has an account", async () => {
    vi.mocked(decideRequest).mockResolvedValue({ ok: true, data: { request: request(2, { status: "approved", inviteStatus: null }) } });
    vi.mocked(listRequests).mockResolvedValue(first);
    render(<RequestsList initial={first} />);
    fireEvent.click(byId(`admin-requests-approve-${uuid(2)}`));
    expect(await screen.findByRole("status")).toHaveTextContent("They already have an account, so no invite was sent.");
  });

  it("asks before rejecting", async () => {
    vi.mocked(decideRequest).mockResolvedValue({ ok: true, data: { request: request(3, { status: "rejected" }) } });
    vi.mocked(listRequests).mockResolvedValue(first);
    const { container } = render(<RequestsList initial={first} />);
    fireEvent.click(byId(`admin-requests-reject-${uuid(3)}`));
    expect(decideRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Person 3");
    expectUniqueIds(container);
    fireEvent.click(byId("admin-requests-confirm-confirm"));
    expect(await screen.findByRole("status")).toHaveTextContent("Rejected person3@example.test.");
    expect(decideRequest).toHaveBeenCalledWith(uuid(3), "reject");
  });

  it("offers Resend only on approved requests", () => {
    render(<RequestsList initial={pageOf([request(1, { status: "approved", inviteStatus: "failed", inviteError: "smtp" })], 1, 1)} />);
    expect(byId(`admin-requests-resend-${uuid(1)}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText("approved · invite failed")).toBeInTheDocument();
  });

  it("explains a failed load and retries", async () => {
    vi.mocked(listRequests).mockResolvedValue(first);
    const { container } = render(<RequestsList initial={fail(503, "unavailable", "Can't reach the database.")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load requests: Can't reach the database.");
    expectUniqueIds(container);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Showing 1–5 of 16")).toBeInTheDocument();
  });
});

describe("UsersList", () => {
  const first = pageOf(
    [0, 1, 2].map((n) => user(n)),
    1,
    3,
  );

  it("lists users without actions on yourself, with unique ids", () => {
    const { container } = render(<UsersList initial={first} selfId={uuid(100)} />);
    expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Deactivate" })).toHaveLength(2);
    expect(document.getElementById(`admin-users-deactivate-${uuid(100)}`)).toBeNull();
    expect(document.getElementById(`admin-users-delete-${uuid(100)}`)).toBeNull();
    fireEvent.click(byId(`admin-users-view-${uuid(101)}`));
    expect(within(byId(`admin-users-details-${uuid(101)}`)).getByText("never")).toBeInTheDocument();
    expectUniqueIds(container);
  });

  it("searches by email prefix", async () => {
    vi.mocked(listUsers).mockResolvedValue(pageOf([], 1, 0));
    render(<UsersList initial={first} selfId={uuid(100)} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " Zed " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText('No users with an email starting "Zed".')).toBeInTheDocument();
    expect(listUsers).toHaveBeenCalledWith(1, "Zed");
  });

  it("deactivates after confirming", async () => {
    vi.mocked(setUserStatus).mockResolvedValue({ ok: true, data: { user: user(1, { status: "deactivated" }) } });
    vi.mocked(listUsers).mockResolvedValue(pageOf([user(0), user(1, { status: "deactivated" }), user(2)], 1, 3));
    render(<UsersList initial={first} selfId={uuid(100)} />);
    fireEvent.click(byId(`admin-users-deactivate-${uuid(101)}`));
    fireEvent.click(byId("admin-users-confirm-confirm"));
    expect(await screen.findByRole("status")).toHaveTextContent("Turned off access for user1@example.test.");
    expect(setUserStatus).toHaveBeenCalledWith(uuid(101), "deactivate");
    expect(await screen.findByText("turned off")).toBeInTheDocument();
  });

  it("deletes only after the email is typed, and shows a failed step on the row", async () => {
    vi.mocked(deleteUser).mockResolvedValue(fail(500, "delete_failed", "Couldn't delete the account. (step: storage)"));
    vi.mocked(listUsers).mockResolvedValue(first);
    const { container } = render(<UsersList initial={first} selfId={uuid(100)} />);
    fireEvent.click(byId(`admin-users-delete-${uuid(102)}`));
    const confirm = byId("admin-users-confirm-confirm");
    expect(confirm).toBeDisabled();
    expectUniqueIds(container);
    fireEvent.change(byId("admin-users-confirm-input"), { target: { value: "user2@example.test" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the account. (step: storage)");
    expect(deleteUser).toHaveBeenCalledWith(uuid(102), "user2@example.test");
    expect(screen.queryByRole("status")).toBeNull();
    await waitFor(() => expect(listUsers).toHaveBeenCalledWith(1, ""));
  });

  it("explains a failed load", () => {
    const { container } = render(<UsersList initial={fail(404, "not_found", "Not found.")} selfId={uuid(100)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load users: Not found.");
    expectUniqueIds(container);
  });
});

describe("AdminView", () => {
  it("switches between the requests and users tabs with unique ids", () => {
    const { container } = render(
      <AdminView
        email="admin@example.test"
        selfId={uuid(100)}
        requests={pageOf([request(1)], 1, 1)}
        users={pageOf([user(0)], 1, 1)}
        usageSummary={fail(503, "usage_unavailable", "Can't load usage right now.")}
        usage={pageOf([], 1, 0)}
      />,
    );
    expect(screen.getByRole("tab", { name: "Requests" })).toHaveAttribute("aria-selected", "true");
    expect(byId("admin-panel-users")).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Users" }));
    expect(byId("admin-panel-users")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to chat" })).toHaveAttribute("href", "/");
    expectUniqueIds(container);
  });
});

describe("ConfirmDialog", () => {
  it("cancels on Escape and requires the exact text", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <ConfirmDialog
        id="dlg"
        title="Delete?"
        body="Gone."
        confirmLabel="Delete"
        requireText="a@b.test"
        busy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expectUniqueIds(container);
    fireEvent.change(byId("dlg-input"), { target: { value: "a@b.tes" } });
    fireEvent.submit(byId("dlg-form"));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(byId("dlg-input"), { target: { value: " A@B.test " } });
    fireEvent.submit(byId("dlg-form"));
    expect(onConfirm).toHaveBeenCalledWith("A@B.test");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("puts role=alertdialog on a div that holds the form, and uses the solid danger button", () => {
    render(
      <ConfirmDialog id="dlg" title="Delete?" body="Gone." confirmLabel="Delete" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.tagName).toBe("DIV");
    expect(dialog).toHaveAttribute("id", "dlg-panel");
    expect(dialog).toHaveAccessibleName("Delete?");
    expect(dialog).toHaveAccessibleDescription("Gone.");
    expect(byId("dlg-form").tagName).toBe("FORM");
    expect(byId("dlg-form")).not.toHaveAttribute("role");
    expect(dialog).toContainElement(byId("dlg-form"));
    expect(byId("dlg-confirm").className).toMatch(/\bbg-danger-fg\b/);
    expect(byId("dlg-confirm").className).toMatch(/\btext-bg\b/);
  });
});
