import { z } from "zod";

export const WORKBENCH_VERSION = "0.2.0" as const;
export const HOST_CONTRACT_VERSION = "1.0.0" as const;
export const NATIVE_API_VERSION = "1.0.0" as const;
export const NATIVE_ENGINE_VERSION = "0.2.0" as const;
export const PROTOCOL_VERSION = "0.2.0" as const;

export const NATIVE_CAPABILITIES = [
  "proof.asset.add",
  "proof.event.record",
  "proof.package.inspect",
  "proof.package.seal",
  "proof.package.verify",
  "proof.workspace.create",
  "proof.workspace.open",
  "workbench.state.preferences",
  "workbench.state.recents",
] as const;

export const UNAVAILABLE_FEATURES = [
  "integration.aigcstudio",
  "host.asset-tokens",
  "execution.utility-process",
  "operation.progress-streaming",
  "operation.safe-cancellation",
  "assurance.creator-signature",
  "assurance.trusted-time",
  "assurance.c2pa",
  "rights-protection",
  "official-services",
  "network.upload",
  "telemetry",
] as const;

export const HOST_ERROR_CODES = [
  "HOST_CONTRACT_RESPONSE_INVALID",
  "HOST_REFERENCE_INVALID",
  "HOST_REFERENCE_UNKNOWN",
  "HOST_REFERENCE_EXPIRED",
  "HOST_REFERENCE_KIND_MISMATCH",
  "HOST_REFERENCE_PATH_CHANGED",
  "IPC_REQUEST_INVALID",
  "NATIVE_DISCOVERY_MISSING",
  "NATIVE_DISCOVERY_INVALID",
  "NATIVE_API_INCOMPATIBLE",
  "NATIVE_ENGINE_INCOMPATIBLE",
  "NATIVE_PROTOCOL_INCOMPATIBLE",
  "NATIVE_CAPABILITY_INCONSISTENT",
  "NATIVE_BRIDGE_RESPONSE_INVALID",
] as const;

export type NativeCapabilityId = (typeof NATIVE_CAPABILITIES)[number];
export type UnavailableFeatureId = (typeof UNAVAILABLE_FEATURES)[number];
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

const semVerPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export const semVerSchema = z.string().regex(semVerPattern);

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(value: string): SemVer | undefined {
  const match = semVerPattern.exec(value);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isCompatibleSemVer(required: string, actual: string): boolean {
  const expected = parseSemVer(required);
  const observed = parseSemVer(actual);
  return Boolean(
    expected &&
      observed &&
      expected.major === observed.major &&
      observed.minor >= expected.minor,
  );
}

export const referenceKinds = [
  "workspace-parent",
  "workspace",
  "asset",
  "package",
  "package-output",
  "report-output",
  "task",
  "result",
] as const;
export type ReferenceKind = (typeof referenceKinds)[number];

export const hostReferenceSchema = z
  .object({
    id: z.string().regex(/^ref_[A-Za-z0-9_-]{20,128}$/u),
    kind: z.enum(referenceKinds),
    displayLabel: z.string().min(1).max(512),
    displayPath: z.string().min(1).max(32_767).optional(),
  })
  .strict();

export const workspaceParentReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("workspace-parent") })
  .strict();
export const workspaceReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("workspace") })
  .strict();
export const assetReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("asset") })
  .strict();
export const packageReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("package") })
  .strict();
export const packageOutputReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("package-output") })
  .strict();
export const reportOutputReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("report-output") })
  .strict();
export const taskReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("task") })
  .strict();
export const resultReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("result") })
  .strict();

export type HostReference<K extends ReferenceKind = ReferenceKind> = Readonly<
  Omit<z.infer<typeof hostReferenceSchema>, "kind"> & { kind: K }
>;
export type WorkspaceParentReference = HostReference<"workspace-parent">;
export type WorkspaceReference = HostReference<"workspace">;
export type AssetReference = HostReference<"asset">;
export type PackageReference = HostReference<"package">;
export type PackageOutputReference = HostReference<"package-output">;
export type ReportOutputReference = HostReference<"report-output">;
export type TaskReference = HostReference<"task">;
export type ResultReference = HostReference<"result">;

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
  reference: WorkspaceReference;
  displayPath: string;
  workspace: Workspace;
}

export interface WorkspaceTargetPreview {
  parent: WorkspaceParentReference;
  folderName: string;
  displayPath: string;
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

export interface RecentItem<K extends "workspace" | "package"> {
  reference: HostReference<K>;
  displayPath: string;
  lastOpenedAt: string;
}

export interface WorkbenchState {
  schemaVersion: number;
  preferences: Record<string, string>;
  recentWorkspaces: Array<RecentItem<"workspace">>;
  recentPackages: Array<RecentItem<"package">>;
}

export interface HostError {
  code: string;
  kind: string;
  message: string;
  displayPath?: string;
}

export type HostEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: HostError };
export type BridgeEnvelope<T> = HostEnvelope<T>;

export const nativeDiscoverySchema = z
  .object({
    apiVersion: semVerSchema,
    engineVersion: semVerSchema,
    supportedProtocolVersions: z
      .array(semVerSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length)
      .refine((values) =>
        values.every(
          (value, index) => index === 0 || values[index - 1]! < value,
        ),
      ),
    capabilities: z
      .array(z.string().regex(/^[a-z][a-z0-9.-]{2,100}$/u))
      .min(1)
      .refine((values) => new Set(values).size === values.length)
      .refine((values) =>
        values.every(
          (value, index) => index === 0 || values[index - 1]! < value,
        ),
      ),
    execution: z
      .object({
        napiAsyncTasks: z.literal(true),
        utilityProcessIsolation: z.literal(false),
        progressStreaming: z.literal(false),
        safeCancellation: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type NativeDiscovery = z.infer<typeof nativeDiscoverySchema>;

export class HostContractError extends Error {
  constructor(
    public readonly code: HostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostContractError";
  }
}

export function validateNativeDiscovery(value: unknown): NativeDiscovery {
  const parsed = nativeDiscoverySchema.safeParse(value);
  if (!parsed.success) {
    throw new HostContractError(
      "NATIVE_DISCOVERY_INVALID",
      "Native discovery response is missing, malformed, unsorted, or contains unknown fields.",
    );
  }
  const discovery = parsed.data;
  if (!isCompatibleSemVer(NATIVE_API_VERSION, discovery.apiVersion)) {
    throw new HostContractError(
      "NATIVE_API_INCOMPATIBLE",
      `Native API ${discovery.apiVersion} is incompatible with ${NATIVE_API_VERSION}.`,
    );
  }
  if (discovery.engineVersion !== NATIVE_ENGINE_VERSION) {
    throw new HostContractError(
      "NATIVE_ENGINE_INCOMPATIBLE",
      `Native engine ${discovery.engineVersion} is incompatible with ${NATIVE_ENGINE_VERSION}.`,
    );
  }
  if (!discovery.supportedProtocolVersions.includes(PROTOCOL_VERSION)) {
    throw new HostContractError(
      "NATIVE_PROTOCOL_INCOMPATIBLE",
      `Native engine does not support protocol ${PROTOCOL_VERSION}.`,
    );
  }
  const observed = new Set(discovery.capabilities);
  if (NATIVE_CAPABILITIES.some((capability) => !observed.has(capability))) {
    throw new HostContractError(
      "NATIVE_CAPABILITY_INCONSISTENT",
      "Native discovery response is missing a required implemented capability.",
    );
  }
  const version = parseSemVer(discovery.apiVersion)!;
  if (
    version.minor === 0 &&
    discovery.capabilities.some(
      (capability) =>
        !(NATIVE_CAPABILITIES as readonly string[]).includes(capability),
    )
  ) {
    throw new HostContractError(
      "NATIVE_CAPABILITY_INCONSISTENT",
      "Native API 1.0 advertises an unexpected capability.",
    );
  }
  return discovery;
}

export interface HostDiagnostics {
  hostKind: "standalone";
  workbenchVersion: "0.2.0";
  contractVersion: "1.0.0";
  nativeApiVersion: string;
  engineVersion: string;
  protocolVersion: "0.2.0";
  supportedProtocolVersions: string[];
  capabilities: string[];
  execution: NativeDiscovery["execution"];
  unavailableFeatures: UnavailableFeatureId[];
}

const localDisplayPath = z.string().min(1).max(32_767);
const assetRoleSchema = z.enum([
  "input",
  "output",
  "reference",
  "license",
  "other",
]);
const windowsDeviceName =
  /^(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
export const workspaceFolderNameSchema = z
  .string()
  .min(1, "新工作区文件夹名不能为空。")
  .max(120, "新工作区文件夹名不能超过 120 个字符。")
  .refine((value) => value === value.trim(), "文件夹名首尾不能包含空格。")
  .refine(
    (value) => value !== "." && value !== "..",
    "文件夹名不能是 . 或 ..。",
  )
  .refine(
    (value) =>
      !Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 0x1f || '<>:"/\\|?*'.includes(character),
      ),
    "文件夹名包含路径分隔符、控制字符或跨平台禁用字符。",
  )
  .refine((value) => !value.endsWith("."), "文件夹名不能以点结尾。")
  .refine(
    (value) => !windowsDeviceName.test(value),
    "文件夹名不能使用 Windows 保留设备名。",
  );

export const workspaceTargetRequestSchema = z
  .object({
    parent: workspaceParentReferenceSchema,
    folderName: workspaceFolderNameSchema,
  })
  .strict();
export const initializeWorkspaceRequestSchema = z
  .object({
    parent: workspaceParentReferenceSchema,
    folderName: workspaceFolderNameSchema,
    projectName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const workspaceRequestSchema = z
  .object({ workspace: workspaceReferenceSchema })
  .strict();
export const addAssetRequestSchema = z
  .object({
    workspace: workspaceReferenceSchema,
    source: assetReferenceSchema,
    role: assetRoleSchema,
  })
  .strict();
export const recordEventRequestSchema = z
  .object({
    workspace: workspaceReferenceSchema,
    eventType: z.string().trim().min(1).max(100),
    payloadJson: z
      .string()
      .min(2)
      .max(16 * 1024 * 1024),
  })
  .strict();
export const sealPackageRequestSchema = z
  .object({
    workspace: workspaceReferenceSchema,
    output: packageOutputReferenceSchema,
  })
  .strict();
export const packageRequestSchema = z
  .object({ package: packageReferenceSchema })
  .strict();

const verificationIssueSchema = z
  .object({
    code: z.string(),
    path: z.string().optional(),
    message: z.string(),
  })
  .strict();
export const verificationReportSchema = z
  .object({
    spec_version: z.literal("0.2.0"),
    proof_id: z.string().nullable(),
    verified_at: z.string(),
    status: z.enum(["valid", "invalid", "error"]),
    assurance: z
      .object({
        internal_integrity: z.enum(["valid", "invalid", "not_evaluated"]),
        creator_identity: z.literal("not_verified"),
        digital_signature: z.literal("not_present"),
        trusted_time: z.literal("not_present"),
        originality: z.literal("not_evaluated"),
      })
      .strict(),
    checks: z.array(
      verificationIssueSchema
        .extend({ status: z.enum(["pass", "fail", "skipped"]) })
        .strict(),
    ),
    errors: z.array(verificationIssueSchema),
    warnings: z.array(
      z.object({ code: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
export const saveReportRequestSchema = z
  .object({
    output: reportOutputReferenceSchema,
    report: verificationReportSchema,
  })
  .strict();
export const setPreferenceRequestSchema = z
  .object({
    key: z.enum(["language", "theme", "lastSection", "windowState"]),
    value: z.string().max(2_000),
  })
  .strict();

export const hostErrorSchema = z
  .object({
    code: z.string().min(1).max(160),
    kind: z.string().min(1).max(160),
    message: z.string().min(1).max(16_384),
    displayPath: localDisplayPath.optional(),
  })
  .strict();
export const hostEnvelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: hostErrorSchema }).strict(),
]);

export function hostEnvelopeSchemaFor<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }).strict(),
    z.object({ ok: z.literal(false), error: hostErrorSchema }).strict(),
  ]);
}

export interface ProofHostApi {
  getDiagnostics(): Promise<HostEnvelope<HostDiagnostics>>;
  chooseWorkspaceParent(): Promise<WorkspaceParentReference | null>;
  chooseExistingWorkspace(): Promise<WorkspaceReference | null>;
  chooseAsset(): Promise<AssetReference | null>;
  choosePackage(): Promise<PackageReference | null>;
  choosePackageOutput(): Promise<PackageOutputReference | null>;
  chooseReportOutput(): Promise<ReportOutputReference | null>;
  previewWorkspaceTarget(request: {
    parent: WorkspaceParentReference;
    folderName: string;
  }): Promise<HostEnvelope<WorkspaceTargetPreview>>;
  initializeWorkspace(request: {
    parent: WorkspaceParentReference;
    folderName: string;
    projectName?: string;
  }): Promise<HostEnvelope<WorkspaceSummary>>;
  loadWorkspace(request: {
    workspace: WorkspaceReference;
  }): Promise<HostEnvelope<WorkspaceSummary>>;
  addAsset(request: {
    workspace: WorkspaceReference;
    source: AssetReference;
    role: AssetRole;
  }): Promise<HostEnvelope<{ asset: Asset; workspace: Workspace }>>;
  recordEvent(request: {
    workspace: WorkspaceReference;
    eventType: string;
    payloadJson: string;
  }): Promise<HostEnvelope<{ event: EventRecord }>>;
  sealPackage(request: {
    workspace: WorkspaceReference;
    output: PackageOutputReference;
  }): Promise<
    HostEnvelope<{
      package: PackageReference;
      displayPath: string;
      manifest: Record<string, unknown>;
    }>
  >;
  verifyPackage(request: {
    package: PackageReference;
  }): Promise<HostEnvelope<VerificationReport>>;
  inspectPackage(request: {
    package: PackageReference;
  }): Promise<HostEnvelope<Inspection>>;
  saveReport(request: {
    output: ReportOutputReference;
    report: VerificationReport;
  }): Promise<HostEnvelope<{ displayPath: string }>>;
  getState(): Promise<HostEnvelope<WorkbenchState>>;
  setPreference(request: {
    key: "language" | "theme" | "lastSection" | "windowState";
    value: string;
  }): Promise<HostEnvelope<WorkbenchState>>;
  rebuildRecents(): Promise<HostEnvelope<WorkbenchState>>;
  closeApp(): Promise<void>;
}

export const assetSchema = z
  .object({
    asset_id: z.string().min(1),
    role: assetRoleSchema,
    package_path: z.string().min(1),
    original_name: z.string().min(1),
    media_type: z.string().min(1),
    size_bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();
export const workspaceSchema = z
  .object({
    workspace_version: z.literal("0.2.0"),
    created_at: z.string().min(1),
    project: z.object({ name: z.string().optional() }).strict(),
    assets: z.array(assetSchema),
  })
  .strict();
export const workspaceSummarySchema = z
  .object({
    reference: workspaceReferenceSchema,
    displayPath: localDisplayPath,
    workspace: workspaceSchema,
  })
  .strict();
export const workspaceTargetPreviewSchema = z
  .object({
    parent: workspaceParentReferenceSchema,
    folderName: workspaceFolderNameSchema,
    displayPath: localDisplayPath,
    exists: z.boolean(),
  })
  .strict();
export const eventRecordSchema = z
  .object({
    event_id: z.string().min(1),
    sequence: z.number().int().positive(),
    event_type: z.string().min(1),
    created_at: z.string().min(1),
    previous_event_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    payload: z.record(z.unknown()),
    event_hash: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();
export const inspectionSchema = z
  .object({
    spec_version: z.literal("0.2.0"),
    proof_id: z.string().min(1),
    created_at: z.string().min(1),
    project: z.object({ name: z.string().optional() }).strict(),
    assets: z.array(assetSchema),
    event_chain: z
      .object({
        algorithm: z.literal("sha-256"),
        event_count: z.number().int().nonnegative(),
        root_hash: z
          .string()
          .regex(/^[0-9a-f]{64}$/u)
          .nullable(),
      })
      .strict(),
    assurance_level: z.string().min(1),
    verification_performed: z.literal(false),
  })
  .strict();
const recentWorkspaceSchema = z
  .object({
    reference: workspaceReferenceSchema,
    displayPath: localDisplayPath,
    lastOpenedAt: z.string().min(1),
  })
  .strict();
const recentPackageSchema = recentWorkspaceSchema
  .omit({ reference: true })
  .extend({ reference: packageReferenceSchema })
  .strict();
export const workbenchStateSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    preferences: z.record(z.string()),
    recentWorkspaces: z.array(recentWorkspaceSchema),
    recentPackages: z.array(recentPackageSchema),
  })
  .strict();
export const hostDiagnosticsSchema = z
  .object({
    hostKind: z.literal("standalone"),
    workbenchVersion: z.literal(WORKBENCH_VERSION),
    contractVersion: z.literal(HOST_CONTRACT_VERSION),
    nativeApiVersion: semVerSchema,
    engineVersion: semVerSchema,
    protocolVersion: z.literal(PROTOCOL_VERSION),
    supportedProtocolVersions: z.array(semVerSchema).min(1),
    capabilities: z.array(z.string()).min(1),
    execution: nativeDiscoverySchema.shape.execution,
    unavailableFeatures: z.array(z.enum(UNAVAILABLE_FEATURES)),
  })
  .strict();

export const addAssetResultSchema = z
  .object({ asset: assetSchema, workspace: workspaceSchema })
  .strict();
export const recordEventResultSchema = z
  .object({ event: eventRecordSchema })
  .strict();
export const sealPackageResultSchema = z
  .object({
    package: packageReferenceSchema,
    displayPath: localDisplayPath,
    manifest: z.record(z.unknown()),
  })
  .strict();
export const saveReportResultSchema = z
  .object({ displayPath: localDisplayPath })
  .strict();

export const proofHostResponseSchemas = {
  getDiagnostics: hostEnvelopeSchemaFor(hostDiagnosticsSchema),
  chooseWorkspaceParent: workspaceParentReferenceSchema.nullable(),
  chooseExistingWorkspace: workspaceReferenceSchema.nullable(),
  chooseAsset: assetReferenceSchema.nullable(),
  choosePackage: packageReferenceSchema.nullable(),
  choosePackageOutput: packageOutputReferenceSchema.nullable(),
  chooseReportOutput: reportOutputReferenceSchema.nullable(),
  previewWorkspaceTarget: hostEnvelopeSchemaFor(workspaceTargetPreviewSchema),
  initializeWorkspace: hostEnvelopeSchemaFor(workspaceSummarySchema),
  loadWorkspace: hostEnvelopeSchemaFor(workspaceSummarySchema),
  addAsset: hostEnvelopeSchemaFor(addAssetResultSchema),
  recordEvent: hostEnvelopeSchemaFor(recordEventResultSchema),
  sealPackage: hostEnvelopeSchemaFor(sealPackageResultSchema),
  verifyPackage: hostEnvelopeSchemaFor(verificationReportSchema),
  inspectPackage: hostEnvelopeSchemaFor(inspectionSchema),
  saveReport: hostEnvelopeSchemaFor(saveReportResultSchema),
  getState: hostEnvelopeSchemaFor(workbenchStateSchema),
  setPreference: hostEnvelopeSchemaFor(workbenchStateSchema),
  rebuildRecents: hostEnvelopeSchemaFor(workbenchStateSchema),
  closeApp: z.void(),
} as const;
