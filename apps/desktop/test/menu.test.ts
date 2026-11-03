import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildMenuTemplate } from "../src/main/menu.ts";

const flat = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu as MenuItemConstructorOptions[]) : [])]);

const build = (packaged: boolean, calls: string[] = []) =>
  buildMenuTemplate({
    packaged,
    appName: "Open Agent",
    onServices: () => calls.push("services"),
    onCheckUpdates: () => calls.push("updates"),
    onReloadApp: () => calls.push("reload"),
    onOpenLink: (link) => calls.push(`link:${link}`),
  });

describe("buildMenuTemplate", () => {
  it("has no DevTools item when packaged", () => {
    const items = flat(build(true));
    expect(items.some((i) => i.role === "toggleDevTools")).toBe(false);
  });

  it("has a DevTools item when unpackaged", () => {
    expect(flat(build(false)).some((i) => i.role === "toggleDevTools")).toBe(true);
  });

  it("offers Services & data on ⌘, and Check for updates", () => {
    const items = flat(build(true));
    const services = items.find((i) => i.id === "menu-services");
    expect(services).toMatchObject({ label: "Services & data…", accelerator: "CommandOrControl+," });
    expect(items.find((i) => i.id === "menu-check-updates")).toMatchObject({ label: "Check for updates…" });
  });

  it("keeps the Edit roles the composer needs", () => {
    const roles = flat(build(true)).map((i) => i.role);
    for (const r of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) expect(roles).toContain(r);
  });

  it("wires clicks to the callbacks and the Help links to fixed link ids", () => {
    const calls: string[] = [];
    const items = flat(build(true, calls));
    const click = (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item?.click) throw new Error(`no ${id}`);
      (item.click as () => void)();
    };
    click("menu-services");
    click("menu-check-updates");
    click("menu-reload");
    click("menu-github");
    click("menu-install-guide");
    expect(calls).toEqual(["services", "updates", "reload", "link:github", "link:install-guide"]);
  });

  it("gives every custom item an id", () => {
    for (const i of flat(build(false))) if (!i.role && i.type !== "separator") expect(i.id, i.label).toMatch(/^menu-[a-z-]+$/);
  });
});
