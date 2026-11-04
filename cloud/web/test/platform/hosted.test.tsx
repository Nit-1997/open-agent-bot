import { Link, nativeHistory, useNavigate, usePathname, useSearchParams } from "@oab/ui/platform";
import { api, configureApi, createApiClient } from "@oab/ui/platform/api";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@oab/ui/components/AccountMenu.tsx";
import { ProfileDrawer } from "@oab/ui/components/profile/ProfileDrawer.tsx";
import { hostedPlatform, nextRouter } from "@/lib/platform/hosted";
import { expectUniqueIds } from "../../../packages/ui/test/support/ids.ts";
import { nav } from "../support/navigation";
import { hostedTestPlatform, renderWithPlatform } from "../support/platform";
import { profile, renderShell } from "../support/shell";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());

const handles = {} as { navigate: ReturnType<typeof useNavigate> };

function Probe() {
  const navigate = useNavigate();
  const params = useSearchParams();
  useEffect(() => {
    handles.navigate = navigate;
  }, [navigate]);
  return (
    <div id="probe">
      <p id="probe-path">{usePathname()}</p>
      <p id="probe-q">{params.get("q") ?? ""}</p>
    </div>
  );
}

beforeEach(() => nav.reset("/"));

describe("hosted platform", () => {
  it("reads the path and query from Next", () => {
    nav.reset("/search?q=big");
    renderWithPlatform(<Probe />);
    expect(document.getElementById("probe-path")).toHaveTextContent("/search");
    expect(document.getElementById("probe-q")).toHaveTextContent("big");
    act(() => nav.go("/reports"));
    expect(document.getElementById("probe-path")).toHaveTextContent("/reports");
  });

  it("navigates with the Next router", () => {
    renderWithPlatform(<Probe />);
    act(() => handles.navigate.push("/chats?page=2"));
    expect(nav.push).toHaveBeenCalledWith("/chats?page=2");
    act(() => handles.navigate.replace("/search?q=sur"));
    expect(nav.replace).toHaveBeenCalledWith("/search?q=sur");
    expect(document.getElementById("probe-path")).toHaveTextContent("/search");
  });

  it("renders Link through next/link with every prop", () => {
    const onClick = vi.fn();
    const { container } = renderWithPlatform(
      <Link id="go" href="/reports/r1" className="pill" role="menuitem" aria-label="Open report" title="Open" onClick={onClick}>
        Open
      </Link>,
    );
    const a = screen.getByRole("menuitem", { name: "Open report" });
    expect(Object.fromEntries([...a.attributes].map((x) => [x.name, x.value]))).toEqual({
      id: "go",
      href: "/reports/r1",
      class: "pill",
      role: "menuitem",
      "aria-label": "Open report",
      title: "Open",
    });
    fireEvent.click(a);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/reports/r1");
    expectUniqueIds(container);
  });

  it("uses native history, the given user and the hosted slots without a usage meter", () => {
    const platform = hostedPlatform({ email: "a@b.test", name: "A", isAdmin: true });
    expect(platform.router).toBe(nextRouter);
    expect(platform.router.history).toBe(nativeHistory);
    expect(platform.user).toEqual({ email: "a@b.test", name: "A" });
    expect(Object.keys(platform.slots).sort()).toEqual([
      "accessDisabledNotice",
      "accountMenuExtra",
      "signOut",
      "signOutEverywhere",
      "signedOutNotice",
    ]);
    expect(platform.slots.usageMeter).toBeUndefined();
  });

  it("configures the API client for /api once", () => {
    expect(api().url("/chats")).toBe("/api/chats");
    expect(() => configureApi(createApiClient({ baseUrl: "/elsewhere" }))).toThrow();
    expect(api().url("/artifacts/r1?format=pdf")).toBe("/api/artifacts/r1?format=pdf");
  });
});

describe("hosted slots", () => {
  afterEach(() => vi.unstubAllGlobals());

  const openMenu = async (isAdmin: boolean) => {
    const utils = renderShell(<AccountMenu />, { platform: hostedTestPlatform({ isAdmin }) });
    await act(async () => {
      fireEvent.click(document.getElementById("account-menu-button")!);
    });
    return utils;
  };

  it("shows the admin item only to admins", async () => {
    const member = await openMenu(false);
    expect(document.getElementById("account-menu-theme")).not.toBeNull();
    expect(document.getElementById("account-menu-admin")).toBeNull();
    member.unmount();

    const admin = await openMenu(true);
    const link = document.getElementById("account-menu-admin");
    expect(link).toHaveAttribute("href", "/admin");
    expect(link).toHaveAttribute("role", "menuitem");
    expect(link?.previousElementSibling?.id).toBe("account-menu-theme");
    expect(document.getElementById("account-menu-admin-icon")).not.toBeNull();
    expectUniqueIds(admin.container);
    await act(async () => {
      fireEvent.click(link!);
    });
    expect(nav.push).toHaveBeenCalledWith("/admin");
    expect(document.getElementById("account-menu-list")).toBeNull();
  });

  it("signs out of this device from the account menu", async () => {
    await openMenu(false);
    const form = document.getElementById("account-menu-signout-form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(document.getElementById("account-menu-signout-scope")).toHaveAttribute("value", "local");
    const button = document.getElementById("account-menu-signout");
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("role", "menuitem");
    expect(button?.closest("form")).toBe(form);
    expect(form?.parentElement?.id).toBe("account-menu-footer");
  });

  it("signs out everywhere from the profile drawer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ rows: {} })),
    );
    const { container } = renderWithPlatform(
      <ProfileDrawer
        profile={profile()}
        models={null}
        onSave={async () => {}}
        onClose={() => {}}
        onRestart={() => {}}
        onClear={() => {}}
      />,
    );
    await waitFor(() => expect(document.getElementById("profile-signout-all-row")).not.toBeNull());
    const row = document.getElementById("profile-signout-all-row");
    expect(row?.previousElementSibling?.id).toBe("profile-restart");
    const form = document.getElementById("profile-signout-all-form");
    expect(form?.parentElement).toBe(row);
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(document.getElementById("profile-signout-all-scope")).toHaveAttribute("value", "global");
    expect(document.getElementById("profile-signout-all")).toHaveTextContent("Sign out on all devices");
    expect(document.getElementById("profile-signout-all-hint")?.parentElement).toBe(row);
    expectUniqueIds(container);
  });
});
