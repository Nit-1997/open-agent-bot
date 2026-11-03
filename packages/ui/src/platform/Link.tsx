import type { ComponentType, MouseEvent } from "react";
import type { LinkProps } from "./router.ts";

const isPlainLeftClick = (e: MouseEvent<HTMLAnchorElement>) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (!e.currentTarget.target || e.currentTarget.target === "_self");

export function anchorLink(push: (href: string) => void): ComponentType<LinkProps> {
  function AnchorLink({ onClick, ...props }: LinkProps) {
    return (
      <a
        {...props}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented || !isPlainLeftClick(e)) return;
          e.preventDefault();
          push(props.href);
        }}
      />
    );
  }
  return AnchorLink;
}
