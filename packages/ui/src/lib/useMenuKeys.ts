"use client";

import { type KeyboardEvent, type RefObject, useEffect } from "react";

const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

const itemsOf = (menu: HTMLElement | null) => (menu ? [...menu.querySelectorAll<HTMLElement>(ITEMS)] : []);

export function useMenuKeys(menu: RefObject<HTMLElement | null>, open: boolean, close: (returnFocus: boolean) => void) {
  useEffect(() => {
    if (open) itemsOf(menu.current)[0]?.focus();
  }, [menu, open]);

  return (e: KeyboardEvent<HTMLElement>) => {
    const items = itemsOf(menu.current);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length].focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at < 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  };
}
