import { emptyProfile, type Profile } from "@oab/shared/profile";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileDrawer } from "../../src/components/profile/ProfileDrawer.tsx";
import type { PlatformSlots } from "../../src/platform/index.ts";
import { navRouter } from "../support/navigation.tsx";
import { renderWithPlatform, TEST_USER } from "../support/platform";

const profile: Profile = { ...emptyProfile(), name: "Nitin", onboardedAt: "2026-10-30" };

function DangerStub({ id }: { id: string }) {
  return (
    <button id={id} type="button">
      Delete my account
    </button>
  );
}

const drawer = (slots: PlatformSlots) =>
  renderWithPlatform(
    <ProfileDrawer profile={profile} models={null} onSave={async () => {}} onClose={() => {}} onRestart={() => {}} onClear={() => {}} />,
    { router: navRouter, user: TEST_USER, slots },
  );

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the profileDanger slot", () => {
  it("renders last in the profile's danger section with the id profile-delete-account", () => {
    drawer({ profileDanger: DangerStub });
    const button = screen.getByRole("button", { name: "Delete my account" });
    expect(button).toHaveAttribute("id", "profile-delete-account");
    const section = document.getElementById("profile-drawer-danger")!;
    expect(section.lastElementChild).toBe(button);
  });

  it("renders nothing without the slot", () => {
    drawer({});
    expect(document.getElementById("profile-delete-account")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete my account" })).toBeNull();
    expect(document.getElementById("profile-clear")).not.toBeNull();
  });
});
