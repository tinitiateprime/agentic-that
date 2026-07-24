const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("publishingCompanion", {
  status: () => ipcRenderer.invoke("companion:status"),
  workspaceState: () => ipcRenderer.invoke("companion:workspace-state"),
  setLayout: layout => ipcRenderer.invoke("companion:set-layout", layout),
  openDashboard: () => ipcRenderer.invoke("companion:open-dashboard"),
  reloadDashboard: () => ipcRenderer.invoke("companion:reload-dashboard"),
  installChrome: () => ipcRenderer.invoke("companion:install-chrome"),
  openData: () => ipcRenderer.invoke("companion:open-data"),
  openLogs: () => ipcRenderer.invoke("companion:open-logs"),
  copyCredentials: () => ipcRenderer.invoke("companion:copy-credentials"),
  setAutoStart: enabled => ipcRenderer.invoke("companion:set-auto-start", enabled),
  setInteractionConsent: enabled => ipcRenderer.invoke("companion:set-interaction-consent", enabled),
  emergencyStop: () => ipcRenderer.invoke("companion:emergency-stop"),
  onStatusChanged: callback => ipcRenderer.on("companion:status-changed", callback),
  onWorkspaceState: callback => ipcRenderer.on("companion:workspace-state", (_event, state) => callback(state)),
  onNavigate: callback => ipcRenderer.on("companion:navigate", (_event, section) => callback(section)),
  onLog: callback => ipcRenderer.on("companion:log", (_event, entry) => callback(entry)),
});
