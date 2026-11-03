import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "./shared/actions.ts";

const bridge: DesktopBridge = {
  openServices: () => ipcRenderer.send("app:open-services"),
};

contextBridge.exposeInMainWorld("openAgentDesktop", bridge);
