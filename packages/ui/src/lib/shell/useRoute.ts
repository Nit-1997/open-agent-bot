"use client";

import { parseRoute, type Route } from "@oab/shared/routes";
import { usePathname, useSearchParams } from "@oab/ui/platform";
import { useMemo } from "react";

export function useRoute(): Route | null {
  const pathname = usePathname();
  const params = useSearchParams();
  return useMemo(() => parseRoute(pathname, params), [pathname, params]);
}

export type NavSection = "chat" | "search" | "reports";

export function navSectionOf(route: Route | null): NavSection | null {
  switch (route?.section) {
    case "chat":
    case "chats":
      return "chat";
    case "search":
      return "search";
    case "reports":
    case "report":
      return "reports";
    default:
      return null;
  }
}
