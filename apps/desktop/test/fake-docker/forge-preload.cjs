const { contextBridge, ipcRenderer } = require("electron");

const forge = Promise.all([ipcRenderer.invoke("shell:act", { type: "quit" }), ipcRenderer.invoke("shell:state")]).then(([act, state]) => ({
  act,
  state,
}));
ipcRenderer.send("app:open-services");
forge.then((result) => contextBridge.exposeInMainWorld("__forge", result));
