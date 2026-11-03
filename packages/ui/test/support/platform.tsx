import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Link, type Platform, PlatformProvider, type PlatformSlots, type SlotItemProps } from "../../src/platform/index.ts";
import { navRouter } from "./navigation.tsx";

export const TEST_USER = { email: "ntn@example.test", name: "Nitin Bhat" };

function SignOutStub({ id, role, className, children }: SlotItemProps & { children: ReactNode }) {
  return (
    <form id={`${id}-form`}>
      <button id={id} type="button" role={role} className={className}>
        {children}
      </button>
    </form>
  );
}

function SignOutEverywhereStub({ id }: { id: string }) {
  return (
    <div id={`${id}-row`}>
      <button id={id} type="button">
        Sign out on all devices
      </button>
    </div>
  );
}

function AdminStub({ id, role, className, onSelect }: SlotItemProps) {
  return (
    <Link id={`${id}-admin`} href="/admin" role={role} onClick={onSelect} className={className}>
      Admin
    </Link>
  );
}

const MEMBER_SLOTS: PlatformSlots = Object.freeze({ signOut: SignOutStub, signOutEverywhere: SignOutEverywhereStub });
const ADMIN_SLOTS: PlatformSlots = Object.freeze({ ...MEMBER_SLOTS, accountMenuExtra: AdminStub });

export const shellPlatform = (opts: { isAdmin?: boolean } = {}): Platform => ({
  router: navRouter,
  user: TEST_USER,
  slots: opts.isAdmin ? ADMIN_SLOTS : MEMBER_SLOTS,
});

export const withPlatform = (ui: ReactNode, platform: Platform = shellPlatform()) => (
  <PlatformProvider platform={platform}>{ui}</PlatformProvider>
);

export function renderWithPlatform(ui: ReactNode, platform: Platform = shellPlatform()) {
  const utils = render(withPlatform(ui, platform));
  return { ...utils, rerender: (next: ReactNode) => utils.rerender(withPlatform(next, platform)) };
}
