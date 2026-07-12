export type AssetRole = "input" | "output" | "reference" | "license" | "other";
export type VerificationStatus = "valid" | "invalid" | "error";
export type CheckStatus = "pass" | "fail" | "skipped";

export interface Asset {
  asset_id: string;
  role: AssetRole;
  package_path: string;
  original_name: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
}

export interface Workspace {
  workspace_version: "0.2.0";
  created_at: string;
  project: { name?: string };
  assets: Asset[];
}

export interface WorkspaceSummary {
  path: string;
  workspace: Workspace;
}

export interface WorkspaceTargetPreview {
  parent: string;
  folderName: string;
  path: string;
  exists: boolean;
}

export interface EventRecord {
  event_id: string;
  sequence: number;
  event_type: string;
  created_at: string;
  previous_event_hash: string | null;
  payload: Record<string, unknown>;
  event_hash: string;
}

export interface VerificationReport {
  spec_version: "0.2.0";
  proof_id: string | null;
  verified_at: string;
  status: VerificationStatus;
  assurance: {
    internal_integrity: "valid" | "invalid" | "not_evaluated";
    creator_identity: "not_verified";
    digital_signature: "not_present";
    trusted_time: "not_present";
    originality: "not_evaluated";
  };
  checks: Array<{
    code: string;
    status: CheckStatus;
    path?: string;
    message: string;
  }>;
  errors: Array<{ code: string; path?: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}

export interface Inspection {
  spec_version: "0.2.0";
  proof_id: string;
  created_at: string;
  project: { name?: string };
  assets: Asset[];
  event_chain: {
    algorithm: "sha-256";
    event_count: number;
    root_hash: string | null;
  };
  assurance_level: string;
  verification_performed: false;
}

export interface RecentItem {
  path: string;
  lastOpenedAt: string;
}

export interface WorkbenchState {
  schemaVersion: number;
  preferences: Record<string, string>;
  recentWorkspaces: RecentItem[];
  recentPackages: RecentItem[];
}

export interface BridgeError {
  code: string;
  kind: string;
  message: string;
  path?: string;
}

export type BridgeEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: BridgeError };

export interface AigcProofApi {
  chooseWorkspaceParent(): Promise<string | null>;
  chooseExistingWorkspace(): Promise<string | null>;
  chooseAsset(): Promise<string | null>;
  choosePackage(): Promise<string | null>;
  choosePackageOutput(): Promise<string | null>;
  chooseReportOutput(): Promise<string | null>;
  previewWorkspaceTarget(request: {
    parent: string;
    folderName: string;
  }): Promise<BridgeEnvelope<WorkspaceTargetPreview>>;
  initializeWorkspace(request: {
    parent: string;
    folderName: string;
    projectName?: string;
  }): Promise<BridgeEnvelope<WorkspaceSummary>>;
  loadWorkspace(request: {
    path: string;
  }): Promise<BridgeEnvelope<WorkspaceSummary>>;
  addAsset(request: {
    workspace: string;
    source: string;
    role: AssetRole;
  }): Promise<BridgeEnvelope<{ asset: Asset; workspace: Workspace }>>;
  recordEvent(request: {
    workspace: string;
    eventType: string;
    payloadJson: string;
  }): Promise<BridgeEnvelope<{ event: EventRecord }>>;
  sealPackage(request: {
    workspace: string;
    output: string;
  }): Promise<
    BridgeEnvelope<{ path: string; manifest: Record<string, unknown> }>
  >;
  verifyPackage(request: {
    path: string;
  }): Promise<BridgeEnvelope<VerificationReport>>;
  inspectPackage(request: {
    path: string;
  }): Promise<BridgeEnvelope<Inspection>>;
  saveReport(request: {
    path: string;
    report: VerificationReport;
  }): Promise<BridgeEnvelope<{ path: string }>>;
  getState(): Promise<BridgeEnvelope<WorkbenchState>>;
  setPreference(request: {
    key: "language" | "theme" | "lastSection" | "windowState";
    value: string;
  }): Promise<BridgeEnvelope<WorkbenchState>>;
  rebuildRecents(): Promise<BridgeEnvelope<WorkbenchState>>;
  closeApp(): Promise<void>;
}

declare global {
  interface Window {
    aigcProof: AigcProofApi;
  }
}
