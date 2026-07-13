import type { ProofHostApi } from "@aigc-proof/host-contracts";

// This adapter is the renderer's only dependency on the standalone preload object.
// Consumer UIs can supply another reviewed ProofHostApi implementation instead.
export class StandaloneProofHostAdapter implements ProofHostApi {
  constructor(private readonly bridge: ProofHostApi) {}

  getDiagnostics() {
    return this.bridge.getDiagnostics();
  }
  chooseProviderInstallation() {
    return this.bridge.chooseProviderInstallation();
  }
  inspectProviderInstallation(
    request: Parameters<ProofHostApi["inspectProviderInstallation"]>[0],
  ) {
    return this.bridge.inspectProviderInstallation(request);
  }
  createCreationSession(
    request: Parameters<ProofHostApi["createCreationSession"]>[0],
  ) {
    return this.bridge.createCreationSession(request);
  }
  getCreationSessions() {
    return this.bridge.getCreationSessions();
  }
  freezeCreationSession(
    request: Parameters<ProofHostApi["freezeCreationSession"]>[0],
  ) {
    return this.bridge.freezeCreationSession(request);
  }
  runCreationSession(
    request: Parameters<ProofHostApi["runCreationSession"]>[0],
  ) {
    return this.bridge.runCreationSession(request);
  }
  cancelCreationSession(
    request: Parameters<ProofHostApi["cancelCreationSession"]>[0],
  ) {
    return this.bridge.cancelCreationSession(request);
  }
  completeCreationProof(
    request: Parameters<ProofHostApi["completeCreationProof"]>[0],
  ) {
    return this.bridge.completeCreationProof(request);
  }
  subscribeCreationEvents(
    listener: Parameters<ProofHostApi["subscribeCreationEvents"]>[0],
  ) {
    return this.bridge.subscribeCreationEvents(listener);
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
  startJob(request: Parameters<ProofHostApi["startJob"]>[0]) {
    return this.bridge.startJob(request);
  }
  getJobs() {
    return this.bridge.getJobs();
  }
  getJobResult(request: Parameters<ProofHostApi["getJobResult"]>[0]) {
    return this.bridge.getJobResult(request);
  }
  cancelJob(request: Parameters<ProofHostApi["cancelJob"]>[0]) {
    return this.bridge.cancelJob(request);
  }
  subscribeJobEvents(
    listener: Parameters<ProofHostApi["subscribeJobEvents"]>[0],
  ) {
    return this.bridge.subscribeJobEvents(listener);
  }
  closeApp() {
    return this.bridge.closeApp();
  }
}
