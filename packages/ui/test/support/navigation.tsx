import { useSyncExternalStore } from "react";
import { vi } from "vitest";
import { type LinkProps, nativeHistory, type PlatformRouter } from "../../src/platform/index.ts";

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

const subscribe = (cb: () => void) => {
  nav.listeners.add(cb);
  return () => nav.listeners.delete(cb);
};

const navigate = Object.freeze({ push: (href: string) => nav.push(href), replace: (href: string) => nav.replace(href) });

function NavLink({ href, children, onClick, ...rest }: LinkProps) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
        nav.push(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export const navRouter: PlatformRouter = Object.freeze({
  usePathname: () => useSyncExternalStore(subscribe, () => nav.pathname),
  useSearchParams: () => {
    const search = useSyncExternalStore(subscribe, () => nav.search);
    return new URLSearchParams(search);
  },
  useNavigate: () => navigate,
  Link: NavLink,
  history: nativeHistory,
});

export function syncHistory(): { visit(path: string): void; restore(): void } {
  const replace = window.history.replaceState.bind(window.history);
  const push = window.history.pushState.bind(window.history);
  const here = () => `${window.location.pathname}${window.location.search}`;
  const onPop = () => nav.go(here());
  const replaceSpy = vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
    replace(data, unused, url);
    nav.go(here());
  });
  const pushSpy = vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => {
    push(data, unused, url);
    nav.go(here());
  });
  window.addEventListener("popstate", onPop);
  return {
    visit(path: string) {
      replace(null, "", path);
      nav.go(path);
    },
    restore() {
      window.removeEventListener("popstate", onPop);
      replaceSpy.mockRestore();
      pushSpy.mockRestore();
      replace(null, "", "/");
    },
  };
}
