import { emptyProfile } from "@oab/shared/profile";
import { memoryRouter, type Platform, PlatformProvider, type PlatformSlots } from "../../src/platform/index.ts";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../src/components/shell/AppShell.tsx";
import { noteAuthFailure, resetAuthState } from "../../src/lib/authState.ts";
import { chatIndex } from "../../src/lib/chatIndex.ts";
import { resetProfileStore } from "../../src/lib/profile.ts";
import { copilot } from "../support/copilot";
import { expectUniqueIds } from "../support/ids";
import { mockViewport } from "../support/media";

vi.mock("@copilotkit/react-core/v2", async () => (await import("../support/copilot")).copilotMock());

const USER = { email: "ntn@example.test", name: "Nitin Bhat" };

function respond(url: string): Response {
  const path = url.split("?")[0];
  if (path === "/api/profile") return Response.json({ profile: { ...emptyProfile(), name: "Nitin Bhat", onboardedAt: "2026-10-30" } });
  if (path === "/api/models")
    return Response.json({ default: "openrouter/a", models: [{ id: "openrouter/a", label: "A", provider: "OpenRouter" }] });
  if (path === "/api/chats") return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
  if (path === "/api/onboarding/options") return Response.json({ rows: {} });
  return Response.json({ error: "not_found" }, { status: 404 });
}

const bare = (slots: PlatformSlots = {}): Platform => ({ router: memoryRouter("/"), user: USER, slots });

async function renderShell(platform: Platform, width = 1440) {
  mockViewport(width);
  const utils = render(
    <PlatformProvider platform={platform}>
      <AppShell>{null}</AppShell>
    </PlatformProvider>,
  );
  await waitFor(() => expect(document.getElementById("shell-main")).not.toBeNull());
  await act(async () => {});
  return utils;
}

const click = async (id: string) => {
  await act(async () => {
    fireEvent.click(document.getElementById(id)!);
  });
};

function UsageStub({ id, variant }: { id: string; variant: "sidebar" | "sheet" }) {
  return (
    <p id={id} data-variant={variant}>
      3 of 10 runs
    </p>
  );
}

beforeEach(() => {
  copilot.reset();
  chatIndex.reset();
  resetProfileStore();
  resetAuthState();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => respond(url)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthState();
});

describe("platform slots in the shell", () => {
  it("renders no sign-out, admin or usage items without slots", async () => {
    const { container } = await renderShell(bare());
    await click("account-menu-button");
    expect(document.getElementById("account-menu-profile")).not.toBeNull();
    expect(container.querySelector("[id$='-signout']")).toBeNull();
    expect(container.querySelector("[id$='-signout-form']")).toBeNull();
    expect(container.querySelector("[id$='-admin']")).toBeNull();
    expect(container.querySelector("[id$='-usage']")).toBeNull();
    expectUniqueIds(container);
    await click("account-menu-profile");
    await waitFor(() => expect(document.getElementById("profile-drawer-danger")).not.toBeNull());
    expect(document.getElementById("profile-restart")).not.toBeNull();
    expect(document.getElementById("profile-signout-all-row")).toBeNull();
    expect(document.querySelector("[id$='-signout']")).toBeNull();
    expectUniqueIds(container);
  });

  it("renders no sign-out or usage in the phone account sheet without slots", async () => {
    const { container } = await renderShell(bare(), 390);
    await click("mobile-tabs-you");
    await waitFor(() => expect(document.getElementById("account-sheet-profile")).not.toBeNull());
    expect(document.querySelector("[id$='-signout']")).toBeNull();
    expect(document.getElementById("account-sheet-usage")).toBeNull();
    expectUniqueIds(container);
  });

  it("shows the neutral session-ended notice on 401 when no signed-out slot is given", async () => {
    const { container } = await renderShell(bare());
    await act(async () => noteAuthFailure(401, "signed_out"));
    const notice = document.getElementById("session-ended");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice?.querySelector("a")).toBeNull();
    expect(document.getElementById("session-signed-out")).toBeNull();
    expectUniqueIds(container);
  });

  it("shows the neutral access-ended notice on 403 when no access-disabled slot is given", async () => {
    noteAuthFailure(403, "account_disabled");
    const { container } = render(
      <PlatformProvider platform={bare()}>
        <AppShell>{null}</AppShell>
      </PlatformProvider>,
    );
    await waitFor(() => expect(document.getElementById("access-ended")).not.toBeNull());
    expect(container.querySelector("a, form, button")).toBeNull();
    expect(document.getElementById("session-disabled")).toBeNull();
    expectUniqueIds(container);
  });

  it("puts the usage meter in the sidebar and the account sheet", async () => {
    const first = await renderShell(bare({ usageMeter: UsageStub }));
    const sidebar = document.getElementById("sidebar-usage");
    expect(sidebar?.querySelector("#sidebar-usage-meter")).toHaveAttribute("data-variant", "sidebar");
    expect(sidebar?.nextElementSibling?.id).toBe("agent-card");
    expectUniqueIds(first.container);
    first.unmount();

    const second = await renderShell(bare({ usageMeter: UsageStub }), 390);
    await click("mobile-tabs-you");
    const sheet = await waitFor(() => {
      const el = document.getElementById("account-sheet-usage");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(sheet.querySelector("#account-sheet-usage-meter")).toHaveAttribute("data-variant", "sheet");
    expect(sheet.parentElement?.id).toBe("account-sheet-body");
    expectUniqueIds(second.container);
  });
});
