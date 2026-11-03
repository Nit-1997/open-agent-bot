"use client";

import { configureApi, createApiClient } from "@oab/ui/platform/api";
import { type LinkProps, nativeHistory, type Platform, PlatformProvider, type PlatformRouter, type PlatformUser } from "@oab/ui/platform";
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useMemo } from "react";

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

export function hostedPlatform(user: PlatformUser): Platform {
  return { router: nextRouter, user, slots: {} };
}

export function HostedPlatform({ user, children }: { user: PlatformUser; children: ReactNode }) {
  const { email, name } = user;
  const platform = useMemo(() => hostedPlatform({ email, name }), [email, name]);
  return <PlatformProvider platform={platform}>{children}</PlatformProvider>;
}
