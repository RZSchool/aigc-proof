import type { ProofHostApi } from "@aigc-proof/host-contracts";

// This adapter is the renderer's only dependency on the standalone preload object.
// Consumer UIs can supply another reviewed ProofHostApi implementation instead.
export class StandaloneProofHostAdapter implements ProofHostApi {
  constructor(private readonly bridge: ProofHostApi) {}

  getDiagnostics() {
    return this.bridge.getDiagnostics();
  }
  chooseWorkspaceParent() {
    return this.bridge.chooseWorkspaceParent();
  }
  chooseExistingWorkspace() {
    return this.bridge.chooseExistingWorkspace();
  }
  chooseAsset() {
    return this.bridge.chooseAsset();
  }
  choosePackage() {
    return this.bridge.choosePackage();
  }
  choosePackageOutput() {
    return this.bridge.choosePackageOutput();
  }
  chooseReportOutput() {
    return this.bridge.chooseReportOutput();
  }
  previewWorkspaceTarget(
    request: Parameters<ProofHostApi["previewWorkspaceTarget"]>[0],
  ) {
    return this.bridge.previewWorkspaceTarget(request);
  }
  initializeWorkspace(
    request: Parameters<ProofHostApi["initializeWorkspace"]>[0],
  ) {
    return this.bridge.initializeWorkspace(request);
  }
  loadWorkspace(request: Parameters<ProofHostApi["loadWorkspace"]>[0]) {
    return this.bridge.loadWorkspace(request);
  }
  addAsset(request: Parameters<ProofHostApi["addAsset"]>[0]) {
    return this.bridge.addAsset(request);
  }
  recordEvent(request: Parameters<ProofHostApi["recordEvent"]>[0]) {
    return this.bridge.recordEvent(request);
  }
  sealPackage(request: Parameters<ProofHostApi["sealPackage"]>[0]) {
    return this.bridge.sealPackage(request);
  }
  verifyPackage(request: Parameters<ProofHostApi["verifyPackage"]>[0]) {
    return this.bridge.verifyPackage(request);
  }
  inspectPackage(request: Parameters<ProofHostApi["inspectPackage"]>[0]) {
    return this.bridge.inspectPackage(request);
  }
  saveReport(request: Parameters<ProofHostApi["saveReport"]>[0]) {
    return this.bridge.saveReport(request);
  }
  getState() {
    return this.bridge.getState();
  }
  setPreference(request: Parameters<ProofHostApi["setPreference"]>[0]) {
    return this.bridge.setPreference(request);
  }
  rebuildRecents() {
    return this.bridge.rebuildRecents();
  }
  closeApp() {
    return this.bridge.closeApp();
  }
}
