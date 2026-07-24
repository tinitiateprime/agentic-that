const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("publishingInteractionLock", {
  emergencyStop: () => ipcRenderer.invoke("companion:emergency-stop"),
});
