export const channels = {
  getDiagnostics: "host:get-diagnostics",
  chooseWorkspaceParent: "dialog:choose-workspace-parent",
  chooseExistingWorkspace: "dialog:choose-existing-workspace",
  chooseAsset: "dialog:choose-asset",
  choosePackage: "dialog:choose-package",
  choosePackageOutput: "dialog:choose-package-output",
  chooseReportOutput: "dialog:choose-report-output",
  previewWorkspaceTarget: "proof:preview-workspace-target",
  initializeWorkspace: "proof:initialize-workspace",
  loadWorkspace: "proof:load-workspace",
  addAsset: "proof:add-asset",
  recordEvent: "proof:record-event",
  sealPackage: "proof:seal-package",
  verifyPackage: "proof:verify-package",
  inspectPackage: "proof:inspect-package",
  saveReport: "proof:save-report",
  getState: "state:get",
  setPreference: "state:set-preference",
  rebuildRecents: "state:rebuild-recents",
  closeApp: "app:close",
} as const;

export type IpcChannel = (typeof channels)[keyof typeof channels];
