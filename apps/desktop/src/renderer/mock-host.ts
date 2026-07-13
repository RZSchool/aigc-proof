import {
  HOST_CONTRACT_VERSION,
  NATIVE_API_VERSION,
  NATIVE_CAPABILITIES,
  NATIVE_ENGINE_VERSION,
  PROTOCOL_VERSION,
  UNAVAILABLE_FEATURES,
  WORKBENCH_VERSION,
  type Asset,
  type HostEnvelope,
  type HostReference,
  type Inspection,
  type ProofHostApi,
  type ReferenceKind,
  type VerificationReport,
  type WorkbenchState,
  type Workspace,
  type WorkspaceReference,
  type WorkspaceSummary,
} from "@aigc-proof/host-contracts";

function ok<T>(data: T): HostEnvelope<T> {
  return { ok: true, data };
}

function reference<K extends ReferenceKind>(
  kind: K,
  label: string,
): HostReference<K> {
  const suffix = `${kind.replaceAll("-", "_")}_${label.replaceAll(" ", "_")}`
    .replaceAll(/[^A-Za-z0-9_]/g, "")
    .padEnd(24, "0")
    .slice(0, 48);
  return {
    id: `ref_${suffix}`,
    kind,
    displayLabel: label,
    displayPath: `MOCK:/${label}`,
  };
}

const emptyWorkspace = (): Workspace => ({
  workspace_version: "0.2.0",
  created_at: "2026-07-13T00:00:00Z",
  project: { name: "Mock project" },
  assets: [],
});

export class DeterministicMockProofHost implements ProofHostApi {
  readonly workspaceParent = reference("workspace-parent", "workspace parent");
  readonly workspaceReference = reference("workspace", "workspace");
  readonly assetReference = reference("asset", "asset.txt");
  readonly packageReference = reference("package", "proof.aigcproof");
  readonly packageOutputReference = reference("package-output", "proof output");
  readonly reportOutputReference = reference("report-output", "report output");
  #workspace = emptyWorkspace();
  #state: WorkbenchState = {
    schemaVersion: 1,
    preferences: {},
    recentWorkspaces: [],
    recentPackages: [],
  };

  getDiagnostics() {
    return Promise.resolve(
      ok({
        hostKind: "standalone" as const,
        workbenchVersion: WORKBENCH_VERSION,
        contractVersion: HOST_CONTRACT_VERSION,
        nativeApiVersion: NATIVE_API_VERSION,
        engineVersion: NATIVE_ENGINE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        supportedProtocolVersions: [PROTOCOL_VERSION],
        capabilities: [...NATIVE_CAPABILITIES],
        execution: {
          napiAsyncTasks: true as const,
          utilityProcessIsolation: false as const,
          progressStreaming: false as const,
          safeCancellation: false as const,
        },
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      }),
    );
  }
  chooseWorkspaceParent() {
    return Promise.resolve(this.workspaceParent);
  }
  chooseExistingWorkspace() {
    return Promise.resolve(this.workspaceReference);
  }
  chooseAsset() {
    return Promise.resolve(this.assetReference);
  }
  choosePackage() {
    return Promise.resolve(this.packageReference);
  }
  choosePackageOutput() {
    return Promise.resolve(this.packageOutputReference);
  }
  chooseReportOutput() {
    return Promise.resolve(this.reportOutputReference);
  }
  previewWorkspaceTarget(
    request: Parameters<ProofHostApi["previewWorkspaceTarget"]>[0],
  ) {
    return Promise.resolve(
      ok({
        parent: request.parent,
        folderName: request.folderName,
        displayPath: `MOCK:/${request.folderName}`,
        exists: false,
      }),
    );
  }
  initializeWorkspace(
    request: Parameters<ProofHostApi["initializeWorkspace"]>[0],
  ) {
    this.#workspace = {
      ...emptyWorkspace(),
      project: request.projectName ? { name: request.projectName } : {},
    };
    return Promise.resolve(ok(this.summary()));
  }
  loadWorkspace(_request: Parameters<ProofHostApi["loadWorkspace"]>[0]) {
    void _request;
    return Promise.resolve(ok(this.summary()));
  }
  addAsset(request: Parameters<ProofHostApi["addAsset"]>[0]) {
    const asset: Asset = {
      asset_id: "mock-asset-1",
      role: request.role,
      package_path: "assets/mock-asset-1.txt",
      original_name: "asset.txt",
      media_type: "text/plain",
      size_bytes: 4,
      sha256: "0".repeat(64),
    };
    this.#workspace = {
      ...this.#workspace,
      assets: [...this.#workspace.assets, asset],
    };
    return Promise.resolve(ok({ asset, workspace: this.#workspace }));
  }
  recordEvent(_request: Parameters<ProofHostApi["recordEvent"]>[0]) {
    void _request;
    return Promise.resolve(
      ok({
        event: {
          event_id: "mock-event-1",
          sequence: 1,
          event_type: "generation",
          created_at: "2026-07-13T00:00:00Z",
          previous_event_hash: null,
          payload: { mock: true },
          event_hash: "1".repeat(64),
        },
      }),
    );
  }
  sealPackage(_request: Parameters<ProofHostApi["sealPackage"]>[0]) {
    void _request;
    return Promise.resolve(
      ok({
        package: this.packageReference,
        displayPath: this.packageReference.displayPath!,
        manifest: { spec_version: PROTOCOL_VERSION },
      }),
    );
  }
  verifyPackage(_request: Parameters<ProofHostApi["verifyPackage"]>[0]) {
    void _request;
    const report: VerificationReport = {
      spec_version: "0.2.0",
      proof_id: "urn:uuid:00000000-0000-4000-8000-000000000000",
      verified_at: "2026-07-13T00:00:00Z",
      status: "valid",
      assurance: {
        internal_integrity: "valid",
        creator_identity: "not_verified",
        digital_signature: "not_present",
        trusted_time: "not_present",
        originality: "not_evaluated",
      },
      checks: [],
      errors: [],
      warnings: [],
    };
    return Promise.resolve(ok(report));
  }
  inspectPackage(_request: Parameters<ProofHostApi["inspectPackage"]>[0]) {
    void _request;
    const inspection: Inspection = {
      spec_version: "0.2.0",
      proof_id: "urn:uuid:00000000-0000-4000-8000-000000000000",
      created_at: "2026-07-13T00:00:00Z",
      project: {},
      assets: this.#workspace.assets,
      event_chain: {
        algorithm: "sha-256",
        event_count: 1,
        root_hash: "1".repeat(64),
      },
      assurance_level: "internal_integrity",
      verification_performed: false,
    };
    return Promise.resolve(ok(inspection));
  }
  saveReport(_request: Parameters<ProofHostApi["saveReport"]>[0]) {
    void _request;
    return Promise.resolve(
      ok({ displayPath: this.reportOutputReference.displayPath! }),
    );
  }
  getState() {
    return Promise.resolve(ok(this.#state));
  }
  setPreference(request: Parameters<ProofHostApi["setPreference"]>[0]) {
    this.#state = {
      ...this.#state,
      preferences: { ...this.#state.preferences, [request.key]: request.value },
    };
    return Promise.resolve(ok(this.#state));
  }
  rebuildRecents() {
    return Promise.resolve(ok(this.#state));
  }
  closeApp() {
    return Promise.resolve();
  }

  private summary(): WorkspaceSummary {
    return {
      reference: this.workspaceReference as WorkspaceReference,
      displayPath: this.workspaceReference.displayPath!,
      workspace: this.#workspace,
    };
  }
}
