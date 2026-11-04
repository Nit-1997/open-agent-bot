import type { MenuItemConstructorOptions } from "electron";
import type { LinkId } from "../shared/actions.ts";

export type MenuDeps = Readonly<{
  packaged: boolean;
  appName: string;
  update?: string;
  onUpdate: () => void;
  onServices: () => void;
  onCheckUpdates: () => void;
  onReloadApp: () => void;
  onOpenLink: (link: LinkId) => void;
}>;

export function buildMenuTemplate(d: MenuDeps): MenuItemConstructorOptions[] {
  return [
    {
      id: "menu-app",
      label: d.appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        ...(d.update ? [{ id: "menu-update", label: `Open Agent ${d.update} is available…`, click: () => d.onUpdate() }] : []),
        { id: "menu-services", label: "Services & data…", accelerator: "CommandOrControl+,", click: () => d.onServices() },
        { id: "menu-check-updates", label: "Check for updates…", click: () => d.onCheckUpdates() },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      id: "menu-edit",
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      id: "menu-view",
      label: "View",
      submenu: [
        { id: "menu-reload", label: "Reload", accelerator: "CommandOrControl+R", click: () => d.onReloadApp() },
        ...(d.packaged ? [] : ([{ type: "separator" }, { role: "toggleDevTools" }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { id: "menu-github", label: "Open Agent on GitHub", click: () => d.onOpenLink("github") },
        { id: "menu-install-guide", label: "Install guide", click: () => d.onOpenLink("install-guide") },
      ],
    },
  ];
}
