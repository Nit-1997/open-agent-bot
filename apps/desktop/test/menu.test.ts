import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildMenuTemplate } from "../src/main/menu.ts";

const flat = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu as MenuItemConstructorOptions[]) : [])]);

const build = (packaged: boolean, calls: string[] = [], update?: string) =>
  buildMenuTemplate({
    packaged,
    appName: "Open Agent",
    ...(update ? { update } : {}),
    onUpdate: () => calls.push("update"),
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

  it("has no update item without a new version", () => {
    expect(flat(build(true)).some((i) => i.id === "menu-update")).toBe(false);
  });

  it("shows the new version above Services & data, and its click opens the update row", () => {
    const calls: string[] = [];
    const app = build(true, calls, "99.0.0")[0]?.submenu as MenuItemConstructorOptions[];
    const ids = app.map((i) => i.id ?? i.role ?? i.type);
    expect(ids.indexOf("menu-update")).toBeGreaterThan(-1);
    expect(ids.indexOf("menu-update")).toBe(ids.indexOf("menu-services") - 1);
    const item = app.find((i) => i.id === "menu-update");
    expect(item?.label).toBe("Open Agent 99.0.0 is available…");
    if (!item?.click) throw new Error("no menu-update click");
    (item.click as () => void)();
    expect(calls).toEqual(["update"]);
  });
});
