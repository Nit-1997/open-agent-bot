import { emptyProfile } from "@oab/shared/profile";
import { ProfileDrawer } from "@oab/ui/components/profile/ProfileDrawer.tsx";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteOwnAccount } from "@/app/account/actions";
import { DeleteAccountDialog } from "@/components/account/DeleteAccountDialog";
import { DELETE_ACCOUNT_COPY } from "@/lib/accountCopy";
import { expectUniqueIds } from "../../../../packages/ui/test/support/ids.ts";
import { renderWithPlatform, TEST_USER } from "../support/platform";

vi.mock("@/app/account/actions", () => ({ deleteOwnAccount: vi.fn() }));
vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());

const el = (id: string) => document.getElementById(id);
const type = (value: string) => fireEvent.change(el("delete-account-email")!, { target: { value } });

beforeEach(() => {
  vi.mocked(deleteOwnAccount).mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  const onCancel = vi.fn();
  const onDeleted = vi.fn();
  const utils = render(<DeleteAccountDialog email={TEST_USER.email} onCancel={onCancel} onDeleted={onDeleted} />);
  return { ...utils, onCancel, onDeleted };
}

describe("the profile's Delete my account (profileDanger)", () => {
  it("shows the button last in the hosted profile's danger section and opens the confirm dialog with the email field focused", async () => {
    const { container } = renderWithPlatform(
      <ProfileDrawer
        profile={{ ...emptyProfile(), name: "Nitin", onboardedAt: "2026-10-30" }}
        models={null}
        onSave={async () => {}}
        onClose={() => {}}
        onRestart={() => {}}
        onClear={() => {}}
      />,
    );
    const button = el("profile-delete-account")!;
    expect(button).toHaveTextContent(DELETE_ACCOUNT_COPY.open);
    expect(el("profile-drawer-danger")!.lastElementChild).toBe(el("profile-delete-account-row"));
    expect(el("delete-account-dialog")).toBeNull();
    fireEvent.click(button);
    expect(el("delete-account-dialog")).toHaveAttribute("role", "alertdialog");
    expect(el("delete-account-email-label")).toHaveTextContent(`Type ${TEST_USER.email} to confirm`);
    await waitFor(() => expect(document.activeElement).toBe(el("delete-account-email")));
    expectUniqueIds(container);
    fireEvent.click(el("delete-account-cancel")!);
    expect(el("delete-account-dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("closes only the dialog on Escape, never the profile drawer behind it", () => {
    const onClose = vi.fn();
    renderWithPlatform(
      <ProfileDrawer
        profile={{ ...emptyProfile(), name: "Nitin", onboardedAt: "2026-10-30" }}
        models={null}
        onSave={async () => {}}
        onClose={onClose}
        onRestart={() => {}}
        onClear={() => {}}
      />,
    );
    fireEvent.click(el("profile-delete-account")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(el("delete-account-dialog")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DeleteAccountDialog", () => {
  it("is a labelled modal alert dialog whose confirm button waits for the exact email (any case)", () => {
    const { container } = mount();
    const dialog = el("delete-account-dialog")!;
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "delete-account-title");
    expect(dialog).toHaveAttribute("aria-describedby", "delete-account-body");
    expect(el("delete-account-title")).toHaveTextContent(DELETE_ACCOUNT_COPY.title);
    expect(el("delete-account-body")).toHaveTextContent("can't be undone");
    const confirm = el("delete-account-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    type("ntn@example");
    expect(confirm.disabled).toBe(true);
    type(` ${TEST_USER.email.toUpperCase()} `);
    expect(confirm.disabled).toBe(false);
    expectUniqueIds(container);
  });

  it("deletes with the typed email and then leaves the app", async () => {
    vi.mocked(deleteOwnAccount).mockResolvedValue({ ok: true, data: { ok: true } });
    const { onDeleted } = mount();
    type(TEST_USER.email);
    await act(async () => {
      fireEvent.click(el("delete-account-confirm")!);
    });
    expect(deleteOwnAccount).toHaveBeenCalledWith(TEST_USER.email);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal in #delete-account-error and stays open", async () => {
    const message = "Admins can't delete their own account here. Ask another admin to remove the admin role first.";
    vi.mocked(deleteOwnAccount).mockResolvedValue({ ok: false, status: 409, error: "admin_self_delete", message });
    const { onDeleted } = mount();
    type(TEST_USER.email);
    await act(async () => {
      fireEvent.submit(el("delete-account-form")!);
    });
    expect(el("delete-account-error")).toHaveAttribute("role", "alert");
    expect(el("delete-account-error")).toHaveTextContent(message);
    expect(onDeleted).not.toHaveBeenCalled();
    expect((el("delete-account-confirm") as HTMLButtonElement).disabled).toBe(false);
  });

  it("never submits before the email matches", async () => {
    mount();
    type("someone@example.test");
    await act(async () => {
      fireEvent.submit(el("delete-account-form")!);
    });
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });

  it("cancels on Escape without letting the key reach the drawer behind it", () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    const { onCancel } = mount();
    fireEvent.keyDown(el("delete-account-email")!, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener("keydown", behind);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("keeps Tab inside the dialog", () => {
    mount();
    type(TEST_USER.email);
    const confirm = el("delete-account-confirm")!;
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(el("delete-account-email"));
    fireEvent.keyDown(el("delete-account-email")!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});
