import { contextBridge, ipcRenderer } from "electron";

import type { ProofHostApi } from "../shared/contracts";
import { channels } from "../shared/channels";

const api: ProofHostApi = {
  getDiagnostics: () => ipcRenderer.invoke(channels.getDiagnostics),
  chooseWorkspaceParent: () =>
    ipcRenderer.invoke(channels.chooseWorkspaceParent),
  chooseExistingWorkspace: () =>
    ipcRenderer.invoke(channels.chooseExistingWorkspace),
  chooseAsset: () => ipcRenderer.invoke(channels.chooseAsset),
  choosePackage: () => ipcRenderer.invoke(channels.choosePackage),
  choosePackageOutput: () => ipcRenderer.invoke(channels.choosePackageOutput),
  chooseReportOutput: () => ipcRenderer.invoke(channels.chooseReportOutput),
  previewWorkspaceTarget: (request) =>
    ipcRenderer.invoke(channels.previewWorkspaceTarget, request),
  initializeWorkspace: (request) =>
    ipcRenderer.invoke(channels.initializeWorkspace, request),
  loadWorkspace: (request) =>
    ipcRenderer.invoke(channels.loadWorkspace, request),
  addAsset: (request) => ipcRenderer.invoke(channels.addAsset, request),
  recordEvent: (request) => ipcRenderer.invoke(channels.recordEvent, request),
  sealPackage: (request) => ipcRenderer.invoke(channels.sealPackage, request),
  verifyPackage: (request) =>
    ipcRenderer.invoke(channels.verifyPackage, request),
  inspectPackage: (request) =>
    ipcRenderer.invoke(channels.inspectPackage, request),
  saveReport: (request) => ipcRenderer.invoke(channels.saveReport, request),
  getState: () => ipcRenderer.invoke(channels.getState),
  setPreference: (request) =>
    ipcRenderer.invoke(channels.setPreference, request),
  rebuildRecents: () => ipcRenderer.invoke(channels.rebuildRecents),
  closeApp: () => ipcRenderer.invoke(channels.closeApp),
};
Object.freeze(api);

contextBridge.exposeInMainWorld("aigcProof", api);
