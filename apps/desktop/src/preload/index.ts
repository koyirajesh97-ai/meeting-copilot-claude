// The only bridge between renderers and the main process. Exposes a small typed API;
// renderers get no Node, no ipcRenderer and no secret values.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type AppState, type CopilotApi } from "../shared/ipc";

const api: CopilotApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (listener) => {
    const wrapped = (_e: IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on(IPC.state, wrapped);
    return () => ipcRenderer.removeListener(IPC.state, wrapped);
  },
  toggleCapture: () => ipcRenderer.invoke(IPC.toggleCapture),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  overlay: {
    setExpanded: (expanded) => ipcRenderer.invoke(IPC.overlaySetExpanded, expanded),
    action: (action) => ipcRenderer.invoke(IPC.overlayAction, action),
  },
  openMain: (route) => ipcRenderer.invoke(IPC.openMain, route),
  secrets: {
    set: (name, value) => ipcRenderer.invoke(IPC.secretSet, name, value),
    has: (name) => ipcRenderer.invoke(IPC.secretHas, name),
    delete: (name) => ipcRenderer.invoke(IPC.secretDelete, name),
  },
};

contextBridge.exposeInMainWorld("copilot", api);
