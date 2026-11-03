"use client";

import { hrefFor, type Route } from "@oab/shared/routes";
import { useNavigate } from "../../platform/index.ts";
import { useCallback } from "react";

export function usePageNav(build: (page: number) => Route) {
  const router = useNavigate();
  const push = useCallback((page: number) => router.push(hrefFor(build(page))), [router, build]);
  const replace = useCallback((page: number) => router.replace(hrefFor(build(page))), [router, build]);
  return { push, replace };
}
