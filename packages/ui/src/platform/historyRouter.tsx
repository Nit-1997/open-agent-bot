"use client";

import { useMemo, useSyncExternalStore } from "react";
import { anchorLink } from "./Link.tsx";
import type { Navigate, PlatformHistory, PlatformRouter, SearchParams } from "./router.ts";

type Location = Readonly<{ pathname: string; search: string }>;

type Store = Readonly<{
  subscribe(listener: () => void): () => void;
  pathname(): string;
  search(): string;
}>;

function routerFrom(store: Store, history: PlatformHistory): PlatformRouter {
  const navigate: Navigate = Object.freeze({
    push: (href: string) => history.push(null, href),
    replace: (href: string) => history.replace(null, href),
  });
  return {
    usePathname: () => useSyncExternalStore(store.subscribe, store.pathname, store.pathname),
    useSearchParams: (): SearchParams => {
      const search = useSyncExternalStore(store.subscribe, store.search, store.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
    useNavigate: () => navigate,
    Link: anchorLink(navigate.push),
    history,
  };
}

function listeners() {
  const set = new Set<() => void>();
  return {
    add(listener: () => void) {
      set.add(listener);
      return () => void set.delete(listener);
    },
    notify() {
      for (const l of set) l();
    },
    get size() {
      return set.size;
    },
  };
}

export function historyRouter(): PlatformRouter {
  const subs = listeners();
  const onPop = () => subs.notify();
  const store: Store = {
    subscribe(listener) {
      if (subs.size === 0) window.addEventListener("popstate", onPop);
      const remove = subs.add(listener);
      return () => {
        remove();
        if (subs.size === 0) window.removeEventListener("popstate", onPop);
      };
    },
    pathname: () => window.location.pathname,
    search: () => window.location.search.replace(/^\?/, ""),
  };
  const history: PlatformHistory = Object.freeze({
    push(state: unknown, href: string) {
      window.history.pushState(state, "", href);
      subs.notify();
    },
    replace(state: unknown, href: string) {
      window.history.replaceState(state, "", href);
      subs.notify();
    },
    back: () => window.history.back(),
    state: () => window.history.state as unknown,
  });
  return Object.freeze(routerFrom(store, history));
}

const MEMORY_ORIGIN = "http://memory.invalid";

export function memoryRouter(initial: string): PlatformRouter & { entries: string[] } {
  const subs = listeners();
  const entries: string[] = [];
  const states: unknown[] = [];
  let index = 0;
  let at: Location = { pathname: "/", search: "" };

  const write = (i: number, state: unknown, href: string) => {
    const url = new URL(href, `${MEMORY_ORIGIN}${entries[index] ?? "/"}`);
    entries[i] = `${url.pathname}${url.search}`;
    states[i] = state;
  };
  const go = (i: number) => {
    index = i;
    const url = new URL(entries[i], MEMORY_ORIGIN);
    at = { pathname: url.pathname, search: url.search.replace(/^\?/, "") };
    subs.notify();
  };

  write(0, null, initial);
  go(0);

  const store: Store = { subscribe: (l) => subs.add(l), pathname: () => at.pathname, search: () => at.search };
  const history: PlatformHistory = Object.freeze({
    push(state: unknown, href: string) {
      entries.length = index + 1;
      states.length = index + 1;
      write(index + 1, state, href);
      go(index + 1);
    },
    replace(state: unknown, href: string) {
      write(index, state, href);
      go(index);
    },
    back() {
      if (index > 0) go(index - 1);
    },
    state: () => states[index] ?? null,
  });
  return Object.freeze({ ...routerFrom(store, history), entries });
}
