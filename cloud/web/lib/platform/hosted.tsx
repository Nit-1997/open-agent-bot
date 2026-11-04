"use client";

import { configureApi, createApiClient } from "@oab/ui/platform/api";
import { type LinkProps, nativeHistory, type Platform, PlatformProvider, type PlatformRouter, type PlatformSlots } from "@oab/ui/platform";
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { AccessDisabled } from "@/components/session/AccessDisabled";
import { AdminItem, SignOutItem } from "@/components/session/AccountSlots";
import { SignedOutBanner } from "@/components/session/SignedOutBanner";
import { SignOutEverywhere } from "@/components/session/SignOutEverywhere";
import type { SessionUser } from "@/lib/sessionUser";

configureApi(createApiClient({ baseUrl: "/api" }));

function HostedLink(props: LinkProps) {
  return <NextLink {...props} />;
}

export const nextRouter: PlatformRouter = Object.freeze({
  usePathname,
  useSearchParams,
  useNavigate: useRouter,
  Link: HostedLink,
  history: nativeHistory,
});

export type HostedUser = Pick<SessionUser, "email" | "name" | "isAdmin">;

const MEMBER_SLOTS: PlatformSlots = Object.freeze({
  signOut: SignOutItem,
  signOutEverywhere: SignOutEverywhere,
  signedOutNotice: SignedOutBanner,
  accessDisabledNotice: AccessDisabled,
});

const ADMIN_SLOTS: PlatformSlots = Object.freeze({ ...MEMBER_SLOTS, accountMenuExtra: AdminItem });

export function hostedPlatform(user: HostedUser): Platform {
  return {
    router: nextRouter,
    user: { email: user.email, name: user.name },
    slots: user.isAdmin ? ADMIN_SLOTS : MEMBER_SLOTS,
  };
}

export function HostedPlatform({ user, children }: { user: HostedUser; children: ReactNode }) {
  const { email, name, isAdmin } = user;
  const platform = useMemo(() => hostedPlatform({ email, name, isAdmin }), [email, name, isAdmin]);
  return <PlatformProvider platform={platform}>{children}</PlatformProvider>;
}
