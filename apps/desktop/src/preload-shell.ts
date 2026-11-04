import { contextBridge, ipcRenderer } from "electron";
import type { ActResult, ShellAction, ShellBridge, ShellState } from "./shared/actions.ts";

const bridge: ShellBridge = {
  getState: () => ipcRenderer.invoke("shell:state") as Promise<ShellState>,
  onState: (cb) => {
    ipcRenderer.on("shell:state", (_event, s: ShellState) => cb(s));
  },
  act: (action: ShellAction) => ipcRenderer.invoke("shell:act", action) as Promise<ActResult>,
};

contextBridge.exposeInMainWorld("shell", bridge);
