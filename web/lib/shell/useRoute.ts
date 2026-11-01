"use client";

import { parseRoute, type Route } from "@shared/routes";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

export function useRoute(): Route | null {
  const pathname = usePathname();
  const params = useSearchParams();
  return useMemo(() => parseRoute(pathname, params), [pathname, params]);
}

export type NavSection = "chat" | "search" | "reports" | "plans";

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
    case "plans":
    case "plan":
      return "plans";
    default:
      return null;
  }
}
