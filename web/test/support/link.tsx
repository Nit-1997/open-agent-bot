import type { AnchorHTMLAttributes, ReactNode } from "react";
import { nav } from "./navigation";

export const linkMock = () => ({
  default: ({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
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
  ),
});
