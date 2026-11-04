"use client";

import { createContext, type ReactElement, type ReactNode, useContext } from "react";
import type { LinkProps, PlatformHistory, PlatformRouter } from "./router.ts";
import type { PlatformSlots } from "./slots.ts";
import type { PlatformUser } from "./user.ts";

export type Platform = Readonly<{
  router: PlatformRouter;
  user: PlatformUser;
  slots: PlatformSlots;
}>;

const PlatformContext = createContext<Platform | null>(null);

export function PlatformProvider(props: { platform: Platform; children: ReactNode }): ReactElement {
  return <PlatformContext.Provider value={props.platform}>{props.children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("usePlatform needs a PlatformProvider");
  return platform;
}

const NO_SLOTS: PlatformSlots = Object.freeze({});

export function usePlatformSlots(): PlatformSlots {
  return useContext(PlatformContext)?.slots ?? NO_SLOTS;
}

export function usePathname(): string {
  return usePlatform().router.usePathname();
}

export function useSearchParams(): ReturnType<PlatformRouter["useSearchParams"]> {
  return usePlatform().router.useSearchParams();
}

export function useNavigate(): ReturnType<PlatformRouter["useNavigate"]> {
  return usePlatform().router.useNavigate();
}

export function usePlatformHistory(): PlatformHistory {
  return usePlatform().router.history;
}

export function Link(props: LinkProps) {
  const { Link: PlatformLink } = usePlatform().router;
  return <PlatformLink {...props} />;
}
