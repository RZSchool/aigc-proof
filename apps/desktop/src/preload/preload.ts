import { contextBridge, ipcRenderer } from "electron";

import type { ProofHostApi } from "../shared/contracts";
import { channels } from "../shared/channels";

const api: ProofHostApi = {
  getDiagnostics: () => ipcRenderer.invoke(channels.getDiagnostics),
  chooseProviderInstallation: () =>
    ipcRenderer.invoke(channels.chooseProviderInstallation),
  inspectProviderInstallation: (request) =>
    ipcRenderer.invoke(channels.inspectProviderInstallation, request),
  createCreationSession: (request) =>
    ipcRenderer.invoke(channels.createCreationSession, request),
  getCreationSessions: (request) =>
    ipcRenderer.invoke(channels.getCreationSessions, request),
  freezeCreationSession: (request) =>
    ipcRenderer.invoke(channels.freezeCreationSession, request),
  runCreationSession: (request) =>
    ipcRenderer.invoke(channels.runCreationSession, request),
  cancelCreationSession: (request) =>
    ipcRenderer.invoke(channels.cancelCreationSession, request),
  completeCreationProof: (request) =>
    ipcRenderer.invoke(channels.completeCreationProof, request),
  subscribeCreationEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) =>
      listener(value as Parameters<typeof listener>[0]);
    ipcRenderer.on(channels.creationEvent, handler);
    return () => ipcRenderer.off(channels.creationEvent, handler);
  },
  chooseWorkspaceParent: () =>
    ipcRenderer.invoke(channels.chooseWorkspaceParent),
  chooseExistingWorkspace: () =>
    ipcRenderer.invoke(channels.chooseExistingWorkspace),
  chooseAsset: () => ipcRenderer.invoke(channels.chooseAsset),
  chooseImage: () => ipcRenderer.invoke(channels.chooseImage),
  chooseCreationOutput: (request) =>
    ipcRenderer.invoke(channels.chooseCreationOutput, request),
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
  exportCreationOutput: (request) =>
    ipcRenderer.invoke(channels.exportCreationOutput, request),
  matchImageToPackage: (request) =>
    ipcRenderer.invoke(channels.matchImageToPackage, request),
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
  startJob: (request) => ipcRenderer.invoke(channels.startJob, request),
  getJobs: () => ipcRenderer.invoke(channels.getJobs),
  getJobResult: (request) => ipcRenderer.invoke(channels.getJobResult, request),
  cancelJob: (request) => ipcRenderer.invoke(channels.cancelJob, request),
  subscribeJobEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) =>
      listener(value as Parameters<typeof listener>[0]);
    ipcRenderer.on(channels.jobEvent, handler);
    return () => ipcRenderer.off(channels.jobEvent, handler);
  },
  closeApp: () => ipcRenderer.invoke(channels.closeApp),
};
Object.freeze(api);

contextBridge.exposeInMainWorld("aigcProof", api);

if (process.argv.includes("--aigc-proof-preload-qa")) {
  contextBridge.exposeInMainWorld(
    "aigcProofQa",
    Object.freeze({
      crashUtility: () => ipcRenderer.invoke(channels.qaCrashUtility),
    }),
  );
}
