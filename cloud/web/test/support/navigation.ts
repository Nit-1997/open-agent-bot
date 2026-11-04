import { useSyncExternalStore } from "react";
import { vi } from "vitest";
import { nav } from "../../../../packages/ui/test/support/navigation.tsx";

export { nav };

export const navigationMock = () => {
  const router = { push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
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
    useRouter: () => router,
    notFound: () => {
      throw new Error("notFound");
    },
  };
};
