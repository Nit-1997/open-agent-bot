import { useSyncExternalStore } from "react";
import { vi } from "vitest";

export const nav = {
  pathname: "/",
  search: "",
  push: vi.fn((href: string) => nav.go(href)),
  replace: vi.fn((href: string) => nav.go(href)),
  listeners: new Set<() => void>(),
  go(href: string) {
    const url = new URL(href, "https://app.test");
    nav.pathname = url.pathname;
    nav.search = url.search;
    for (const l of nav.listeners) l();
  },
  reset(path = "/") {
    const url = new URL(path, "https://app.test");
    nav.pathname = url.pathname;
    nav.search = url.search;
    nav.push.mockClear();
    nav.replace.mockClear();
  },
};

export const navigationMock = () => {
  const subscribe = (cb: () => void) => {
    nav.listeners.add(cb);
    return () => nav.listeners.delete(cb);
  };
  return {
    usePathname: () => useSyncExternalStore(subscribe, () => nav.pathname),
    useSearchParams: () => {
      const search = useSyncExternalStore(subscribe, () => nav.search);
      return new URLSearchParams(search);
    },
    useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
    notFound: () => {
      throw new Error("notFound");
    },
  };
};
