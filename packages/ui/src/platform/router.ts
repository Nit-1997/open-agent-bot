import type { AnchorHTMLAttributes, ComponentType } from "react";

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { id: string; href: string };

export type PlatformHistory = Readonly<{
  push(state: unknown, href: string): void;
  replace(state: unknown, href: string): void;
  back(): void;
  state(): unknown;
}>;

export type SearchParams = Readonly<{ get(name: string): string | null; toString(): string }>;

export type Navigate = Readonly<{ push(href: string): void; replace(href: string): void }>;

export type PlatformRouter = Readonly<{
  usePathname(): string;
  useSearchParams(): SearchParams;
  useNavigate(): Navigate;
  Link: ComponentType<LinkProps>;
  history: PlatformHistory;
}>;

export const nativeHistory: PlatformHistory = Object.freeze({
  push: (state: unknown, href: string) => window.history.pushState(state, "", href),
  replace: (state: unknown, href: string) => window.history.replaceState(state, "", href),
  back: () => window.history.back(),
  state: () => window.history.state as unknown,
});
