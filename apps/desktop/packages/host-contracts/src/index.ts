import { z } from "zod";

export const WORKBENCH_VERSION = "0.7.0" as const;
export const HOST_CONTRACT_VERSION = "1.6.0" as const;
export const NATIVE_API_VERSION = "1.5.0" as const;
export const NATIVE_ENGINE_VERSION = "0.4.0" as const;
export const PROTOCOL_VERSION = "0.4.0" as const;

export const NATIVE_CAPABILITIES = [
  "execution.phase-progress",
  "proof.asset.add",
  "proof.asset.export",
  "proof.asset.match",
  "proof.event.record",
  "proof.package.inspect",
  "proof.package.seal",
  "proof.package.timestamp.attach",
  "proof.package.timestamp.request",
  "proof.package.verify",
  "proof.signer.create",
  "proof.signer.disable",
  "proof.signer.rotate",
  "proof.signer.status",
  "proof.workspace.create",
  "proof.workspace.open",
  "trust.tsa-profile.validate",
] as const;

export const HOST_CAPABILITIES = [
  "creation.comfyui-local",
  "creation.evidence-mapping",
  "creation.session-lifecycle",
  "creation.sessions.workspace-scoped",
  "creation.snapshot-sha256",
  "execution.bounded-jobs",
  "execution.phase-progress",
  "execution.queued-cancellation",
  "execution.utility-process",
  "proof.asset.add",
  "proof.asset.export",
  "proof.asset.match",
  "proof.event.record",
  "proof.package.inspect",
  "proof.package.seal",
  "proof.package.timestamp.attach",
  "proof.package.timestamp.request",
  "proof.package.verify",
  "proof.signer.create",
  "proof.signer.disable",
  "proof.signer.rotate",
  "proof.signer.status",
  "proof.workspace.create",
  "proof.workspace.open",
  "trust.tsa-profile.import",
  "trust.tsa-profile.validate",
  "workbench.state.preferences",
  "workbench.state.recents",
] as const;

export const RUNTIME_LIMITS = Object.freeze({
  maxConcurrentJobs: 1,
  maxQueuedJobs: 16,
  maxMessageBytes: 1024 * 1024,
  maxProgressEventsPerSecond: 10,
  operationTimeoutMs: 5 * 60 * 1000,
  startupTimeoutMs: 10 * 1000,
  shutdownTimeoutMs: 5 * 1000,
});

export const UNAVAILABLE_FEATURES = [
  "integration.aigcstudio",
  "host.asset-tokens",
  "provider.cloud",
  "provider.remote-endpoint",
  "operation.safe-cancellation",
  "assurance.c2pa",
  "rights-protection",
  "official-services",
  "network.upload",
  "telemetry",
] as const;

export const HOST_ERROR_CODES = [
  "CREATION_RELATIONSHIP_INVALID",
  "CREATION_SESSION_NOT_FOUND",
  "CREATION_STATE_INVALID",
  "HOST_CONTRACT_RESPONSE_INVALID",
  "HOST_REFERENCE_INVALID",
  "HOST_REFERENCE_UNKNOWN",
  "HOST_REFERENCE_EXPIRED",
  "HOST_REFERENCE_KIND_MISMATCH",
  "HOST_REFERENCE_PATH_CHANGED",
  "HOST_REFERENCE_ORIGIN_MISMATCH",
  "HOST_REFERENCE_PERMISSION_DENIED",
  "HOST_REFERENCE_REUSED",
  "IPC_REQUEST_INVALID",
  "JOB_QUEUE_FULL",
  "JOB_NOT_FOUND",
  "JOB_RESULT_NOT_READY",
  "JOB_TRANSITION_INVALID",
  "JOB_TIMEOUT",
  "PROVIDER_CANCELLED",
  "PROVIDER_CAPABILITY_MISSING",
  "PROVIDER_ENDPOINT_INVALID",
  "PROVIDER_INSTALLATION_INVALID",
  "PROVIDER_MALFORMED_OUTPUT",
  "PROVIDER_PROCESS_LOST",
  "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_TIMEOUT",
  "PROVIDER_VERSION_INCOMPATIBLE",
  "UTILITY_HANDSHAKE_FAILED",
  "UTILITY_MESSAGE_INVALID",
  "UTILITY_PROCESS_LOST",
  "UTILITY_SHUTDOWN_TIMEOUT",
  "NATIVE_DISCOVERY_MISSING",
  "NATIVE_DISCOVERY_INVALID",
  "NATIVE_API_INCOMPATIBLE",
  "NATIVE_ENGINE_INCOMPATIBLE",
  "NATIVE_PROTOCOL_INCOMPATIBLE",
  "NATIVE_CAPABILITY_INCONSISTENT",
  "NATIVE_BRIDGE_RESPONSE_INVALID",
] as const;

export type NativeCapabilityId = (typeof NATIVE_CAPABILITIES)[number];
export type HostCapabilityId = (typeof HOST_CAPABILITIES)[number];
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
  "image",
  "image-output",
  "package",
  "package-output",
  "report-output",
  "task",
  "result",
  "diagnostic",
  "provider-installation",
  "creation-session",
  "tsa-profile",
  "timestamp-package-output",
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
export const imageReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("image") })
  .strict();
export const imageOutputReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("image-output") })
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
export const diagnosticReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("diagnostic") })
  .strict();
export const providerInstallationReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("provider-installation") })
  .strict();
export const creationSessionReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("creation-session") })
  .strict();
export const tsaProfileReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("tsa-profile") })
  .strict();
export const timestampPackageOutputReferenceSchema = hostReferenceSchema
  .extend({ kind: z.literal("timestamp-package-output") })
  .strict();

export type HostReference<K extends ReferenceKind = ReferenceKind> = Readonly<
  Omit<z.infer<typeof hostReferenceSchema>, "kind"> & { kind: K }
>;
export type WorkspaceParentReference = HostReference<"workspace-parent">;
export type WorkspaceReference = HostReference<"workspace">;
export type AssetReference = HostReference<"asset">;
export type ImageReference = HostReference<"image">;
export type ImageOutputReference = HostReference<"image-output">;
export type PackageReference = HostReference<"package">;
export type PackageOutputReference = HostReference<"package-output">;
export type ReportOutputReference = HostReference<"report-output">;
export type TaskReference = HostReference<"task">;
export type ResultReference = HostReference<"result">;
export type DiagnosticReference = HostReference<"diagnostic">;
export type ProviderInstallationReference =
  HostReference<"provider-installation">;
export type CreationSessionReference = HostReference<"creation-session">;
export type TsaProfileReference = HostReference<"tsa-profile">;
export type TimestampPackageOutputReference =
  HostReference<"timestamp-package-output">;

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
  workspace_version: "0.2.0" | "0.3.0" | "0.4.0";
  created_at: string;
  project: { name?: string | undefined };
  assets: Asset[];
}

export interface CreatorSignatureDescriptor {
  profile: string;
  signature_id: string;
  display_label: string;
  key_fingerprint: string;
  public_key_path: string;
  signature_path: string;
}

export interface TrustedTimestampDescriptor {
  profile: string;
  timestamp_path: string;
  nonce: string;
  requested_policy: string;
  tsa_profile_sha256: string;
}

export interface TsaProfileSummary {
  profile_sha256: string;
  source_label: string;
  endpoint: string;
  endpoint_scope: "public_https" | "loopback_test";
  allowed_policy_oids: string[];
  root_count: number;
  intermediate_count: number;
  https_root_count: number;
  revocation_evidence_count: number;
  effective_at: string;
  expires_at: string;
}

export type LocalSignerState =
  | "missing"
  | "active"
  | "disabled"
  | "unavailable";

export interface LocalSignerStatus {
  state: LocalSignerState;
  display_label?: string | undefined;
  key_fingerprint?: string | undefined;
  warning_codes: string[];
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
  spec_version: "0.2.0" | "0.3.0" | "0.4.0";
  proof_id: string | null;
  verified_at: string;
  status: VerificationStatus;
  assurance: {
    internal_integrity: "valid" | "invalid" | "not_evaluated";
    creator_identity: "not_verified" | "self_asserted";
    digital_signature:
      | "not_present"
      | "absent"
      | "unsupported"
      | "malformed"
      | "invalid"
      | "valid_untrusted"
      | "valid_locally_trusted"
      | "disabled";
    trusted_time:
      | "not_present"
      | "absent"
      | "acquisition_failed"
      | "malformed"
      | "imprint_mismatch"
      | "nonce_mismatch"
      | "policy_mismatch"
      | "invalid_signature"
      | "invalid_chain"
      | "invalid_eku"
      | "invalid_ess"
      | "untrusted"
      | "expired_or_stale"
      | "indeterminate_revocation"
      | "unsupported_algorithm"
      | "valid_trusted";
    originality: "not_evaluated";
  };
  creator_signature?:
    | {
        display_label: string;
        key_fingerprint: string;
        profile: string;
        local_trust: "untrusted" | "trusted" | "disabled";
      }
    | undefined;
  trusted_time?:
    | {
        profile: string;
        timestamp_path: string;
        tsa_profile_sha256: string;
        requested_policy: string;
        granted_policy?: string | undefined;
        gen_time?: string | undefined;
        source_label?: string | undefined;
        revocation: "not_provided" | "valid_crl" | "revoked" | "indeterminate";
      }
    | undefined;
  checks: Array<{
    code: string;
    status: CheckStatus;
    path?: string | undefined;
    message: string;
  }>;
  errors: Array<{ code: string; path?: string | undefined; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}

export interface Inspection {
  spec_version: "0.2.0" | "0.3.0" | "0.4.0";
  proof_id: string;
  created_at: string;
  project: { name?: string | undefined };
  assets: Asset[];
  event_chain: {
    algorithm: "sha-256";
    event_count: number;
    root_hash: string | null;
  };
  assurance_level: string;
  verification_performed: false;
  creator_signature?: CreatorSignatureDescriptor | undefined;
  trusted_timestamp?: TrustedTimestampDescriptor | undefined;
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

export const CREATION_SNAPSHOT_VERSION = "1.0.0" as const;
export const CREATION_PROVIDER_ID = "comfyui-local" as const;
export const CREATION_TEMPLATE_ID = "comfyui-core-text-to-image-v1" as const;
export const CREATION_TEMPLATE_SHA256 =
  "623d53adee2d221ea3fd62ffa2749466e742c948d190eed7c00f39db1cba4206" as const;

export const creationParametersSchema = z
  .object({
    width: z.number().int().min(64).max(2048).multipleOf(8),
    height: z.number().int().min(64).max(2048).multipleOf(8),
    steps: z.number().int().min(1).max(100),
    cfg: z.number().min(0).max(30),
    sampler: z.enum(["euler", "euler_ancestral", "dpmpp_2m"]),
    scheduler: z.enum(["normal", "karras", "simple"]),
  })
  .strict();
export type CreationParameters = z.infer<typeof creationParametersSchema>;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const creationSnapshotSchema = z
  .object({
    snapshot_version: z.literal(CREATION_SNAPSHOT_VERSION),
    provider: z.literal(CREATION_PROVIDER_ID),
    provider_version: semVerSchema,
    workflow_template_id: z.literal(CREATION_TEMPLATE_ID),
    workflow_template_sha256: z.literal(CREATION_TEMPLATE_SHA256),
    checkpoint_observation: z.string().min(1).max(512),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 50),
    parameters: creationParametersSchema,
    prompt_disclosure: z.enum(["included", "digest-only"]),
    prompt: z.string().max(32_768).optional(),
    negative_prompt: z.string().max(32_768).optional(),
    prompt_sha256: digestSchema,
    negative_prompt_sha256: digestSchema,
    parameters_sha256: digestSchema,
    snapshot_sha256: digestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const disclosed = value.prompt_disclosure === "included";
    if (disclosed !== (value.prompt !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prompt presence must match the disclosure choice.",
      });
    }
    if (disclosed !== (value.negative_prompt !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Negative prompt presence must match the disclosure choice.",
      });
    }
  });
export type CreationSnapshot = z.infer<typeof creationSnapshotSchema>;

export const creationSessionStates = [
  "draft",
  "frozen",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "proof_ready",
  "complete",
] as const;
export type CreationSessionState = (typeof creationSessionStates)[number];

export interface ProviderInstallationSummary {
  reference: ProviderInstallationReference;
  displayPath: string;
  provider: typeof CREATION_PROVIDER_ID;
  detectedVersion: string;
  endpoint: "http://127.0.0.1:8188";
  compatible: true;
  checkpoints: string[];
  customNodeCount: number;
  license: {
    name: "GNU General Public License v3.0";
    spdx: "GPL-3.0-only";
    sha256: string;
  };
}

export interface CreationOutputSummary {
  asset: Asset;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  sha256: string;
  previewDataUrl?: string | undefined;
}

export type ImageMatchStatus =
  | "verified_output_match"
  | "matched_non_output"
  | "not_in_package"
  | "package_invalid";

export interface ImageMatchResult {
  status: ImageMatchStatus;
  verification: VerificationReport;
  image: {
    displayLabel: string;
    displayPath: string;
    mediaType?: "image/png" | "image/jpeg" | "image/webp" | undefined;
    sizeBytes?: number | undefined;
    sha256?: string | undefined;
    previewDataUrl?: string | undefined;
  };
  matchedAssets: Asset[];
}

export interface ExportedCreationOutput {
  image: ImageReference;
  displayPath: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  sha256: string;
}

export interface CreationSessionSummary {
  reference: CreationSessionReference;
  title: string;
  state: CreationSessionState;
  workspace: WorkspaceReference;
  workspaceDisplayPath: string;
  providerInstallation: ProviderInstallationReference;
  providerVersion: string;
  createdAt: string;
  updatedAt: string;
  snapshot?: CreationSnapshot | undefined;
  providerJobId?: string | undefined;
  progress?:
    | {
        completedUnits: number;
        totalUnits: 100;
        message: string;
      }
    | undefined;
  output?: CreationOutputSummary | undefined;
  package?: PackageReference | undefined;
  packageDisplayPath?: string | undefined;
  reportDisplayPath?: string | undefined;
  verification?: VerificationReport | undefined;
  error?: HostError | undefined;
}

export interface CreationSessionEvent {
  sequence: number;
  session: CreationSessionSummary;
}

export type CreationSessionEventListener = (
  event: CreationSessionEvent,
) => void;

export interface HostError {
  code: string;
  kind: string;
  message: string;
  displayPath?: string | undefined;
}

export type HostEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: HostError };
export type BridgeEnvelope<T> = HostEnvelope<T>;

export const runtimeLimitsSchema = z
  .object({
    maxConcurrentJobs: z.number().int().min(1).max(4),
    maxQueuedJobs: z.number().int().min(1).max(64),
    maxMessageBytes: z
      .number()
      .int()
      .min(64 * 1024)
      .max(4 * 1024 * 1024),
    maxProgressEventsPerSecond: z.number().int().min(1).max(30),
    operationTimeoutMs: z
      .number()
      .int()
      .min(10_000)
      .max(30 * 60 * 1000),
    startupTimeoutMs: z.number().int().min(1_000).max(60_000),
    shutdownTimeoutMs: z.number().int().min(1_000).max(30_000),
  })
  .strict();
export type RuntimeLimits = z.infer<typeof runtimeLimitsSchema>;

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
        utilityProcessIsolation: z.literal(true),
        progressStreaming: z.literal(true),
        safeCancellation: z.literal(false),
      })
      .strict(),
    limits: runtimeLimitsSchema,
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
  if (
    discovery.limits.maxConcurrentJobs !== RUNTIME_LIMITS.maxConcurrentJobs ||
    discovery.limits.maxQueuedJobs !== RUNTIME_LIMITS.maxQueuedJobs ||
    discovery.limits.maxMessageBytes !== RUNTIME_LIMITS.maxMessageBytes ||
    discovery.limits.maxProgressEventsPerSecond !==
      RUNTIME_LIMITS.maxProgressEventsPerSecond ||
    discovery.limits.operationTimeoutMs !== RUNTIME_LIMITS.operationTimeoutMs ||
    discovery.limits.startupTimeoutMs !== RUNTIME_LIMITS.startupTimeoutMs ||
    discovery.limits.shutdownTimeoutMs !== RUNTIME_LIMITS.shutdownTimeoutMs
  ) {
    throw new HostContractError(
      "NATIVE_CAPABILITY_INCONSISTENT",
      "Native discovery limits contradict the required Host 1.4 runtime profile.",
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
  reference: DiagnosticReference;
  hostKind: "standalone" | "mock" | "compatible-host";
  workbenchVersion: typeof WORKBENCH_VERSION;
  contractVersion: typeof HOST_CONTRACT_VERSION;
  nativeApiVersion: string;
  engineVersion: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  supportedProtocolVersions: string[];
  capabilities: string[];
  execution: NativeDiscovery["execution"];
  limits: RuntimeLimits;
  utility: {
    state: "starting" | "healthy" | "restarting" | "stopped" | "failed";
    generation: number;
    processId?: number | undefined;
    lastFailureCode?: string | undefined;
  };
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
    confirmSignature: z.literal(true),
  })
  .strict();
export const tsaProfileRequestSchema = z
  .object({ profile: tsaProfileReferenceSchema })
  .strict();
export const requestTrustedTimestampSchema = z
  .object({
    package: packageReferenceSchema,
    output: timestampPackageOutputReferenceSchema,
    confirmDisclosure: z.literal(true),
  })
  .strict();
function isForbiddenCreatorLabelCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}
export const signerLabelSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => new TextEncoder().encode(value).length <= 200, {
    message: "Creator display label must not exceed 200 UTF-8 bytes.",
  })
  .refine((value) => value.normalize("NFC") === value, {
    message: "Creator display label must be NFC normalized.",
  })
  .refine((value) => ![...value].some(isForbiddenCreatorLabelCharacter), {
    message: "Creator display label contains a forbidden control character.",
  });
export const signerLabelRequestSchema = z
  .object({ displayLabel: signerLabelSchema })
  .strict();
export const rotateSignerRequestSchema = signerLabelRequestSchema
  .extend({ confirm: z.literal(true) })
  .strict();
export const disableSignerRequestSchema = z
  .object({ confirm: z.literal(true) })
  .strict();
export const packageRequestSchema = z
  .object({ package: packageReferenceSchema })
  .strict();
export const imageMatchRequestSchema = z
  .object({
    image: imageReferenceSchema,
    package: packageReferenceSchema,
  })
  .strict();
export const exportWorkspaceOutputRequestSchema = z
  .object({
    workspace: workspaceReferenceSchema,
    assetId: z.string().min(1).max(160),
    output: imageOutputReferenceSchema,
  })
  .strict();
export const exportCreationOutputRequestSchema = z
  .object({
    session: creationSessionReferenceSchema,
    output: imageOutputReferenceSchema,
  })
  .strict();

const verificationIssueSchema = z
  .object({
    code: z.string(),
    path: z.string().optional(),
    message: z.string(),
  })
  .strict();
export const creatorSignatureEvidenceSchema = z
  .object({
    display_label: z.string().min(1).max(200),
    key_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    profile: z.string().min(1),
    local_trust: z.enum(["untrusted", "trusted", "disabled"]),
  })
  .strict();
export const verificationReportSchema = z
  .object({
    spec_version: z.enum(["0.2.0", "0.3.0", "0.4.0"]),
    proof_id: z.string().nullable(),
    verified_at: z.string(),
    status: z.enum(["valid", "invalid", "error"]),
    assurance: z
      .object({
        internal_integrity: z.enum(["valid", "invalid", "not_evaluated"]),
        creator_identity: z.enum(["not_verified", "self_asserted"]),
        digital_signature: z.enum([
          "not_present",
          "absent",
          "unsupported",
          "malformed",
          "invalid",
          "valid_untrusted",
          "valid_locally_trusted",
          "disabled",
        ]),
        trusted_time: z.enum([
          "not_present",
          "absent",
          "acquisition_failed",
          "malformed",
          "imprint_mismatch",
          "nonce_mismatch",
          "policy_mismatch",
          "invalid_signature",
          "invalid_chain",
          "invalid_eku",
          "invalid_ess",
          "untrusted",
          "expired_or_stale",
          "indeterminate_revocation",
          "unsupported_algorithm",
          "valid_trusted",
        ]),
        originality: z.literal("not_evaluated"),
      })
      .strict(),
    creator_signature: creatorSignatureEvidenceSchema.optional(),
    trusted_time: z
      .object({
        profile: z.string().min(1),
        timestamp_path: z.string().min(1),
        tsa_profile_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
        requested_policy: z.string().min(1),
        granted_policy: z.string().min(1).optional(),
        gen_time: z.string().min(1).optional(),
        source_label: z.string().min(1).optional(),
        revocation: z.enum([
          "not_provided",
          "valid_crl",
          "revoked",
          "indeterminate",
        ]),
      })
      .strict()
      .optional(),
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
export const inspectProviderInstallationRequestSchema = z
  .object({ installation: providerInstallationReferenceSchema })
  .strict();
export const createCreationSessionRequestSchema = z
  .object({
    workspace: workspaceReferenceSchema,
    installation: providerInstallationReferenceSchema,
    title: z.string().trim().min(1).max(200),
  })
  .strict();
export const getCreationSessionsRequestSchema = workspaceRequestSchema;
export const creationSessionRequestSchema = z
  .object({ session: creationSessionReferenceSchema })
  .strict();
export const freezeCreationSessionRequestSchema = z
  .object({
    session: creationSessionReferenceSchema,
    checkpointObservation: z.string().trim().min(1).max(512),
    prompt: z.string().max(32_768),
    negativePrompt: z.string().max(32_768),
    promptDisclosure: z.enum(["included", "digest-only"]),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 50),
    parameters: creationParametersSchema,
  })
  .strict();
export const completeCreationProofRequestSchema = z
  .object({
    session: creationSessionReferenceSchema,
    packageOutput: packageOutputReferenceSchema,
    reportOutput: reportOutputReferenceSchema,
    confirmSignature: z.literal(true),
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

export const jobOperations = [
  "initializeWorkspace",
  "loadWorkspace",
  "addAsset",
  "exportWorkspaceOutput",
  "matchImageToPackage",
  "recordEvent",
  "getSignerStatus",
  "createSigner",
  "rotateSigner",
  "disableSigner",
  "sealPackage",
  "verifyPackage",
  "inspectPackage",
  "rebuildRecents",
] as const;
export type JobOperation = (typeof jobOperations)[number];

export const jobStates = [
  "queued",
  "running",
  "cancel_requested",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobState = (typeof jobStates)[number];

export const progressPhases = [
  "authorized",
  "queued",
  "utility-startup",
  "native-execution",
  "result-publication",
  "complete",
] as const;
export type ProgressPhase = (typeof progressPhases)[number];

export const jobProgressSchema = z
  .object({
    sequence: z.number().int().positive(),
    phase: z.enum(progressPhases),
    completedUnits: z.number().int().min(0).max(100),
    totalUnits: z.literal(100),
    message: z.string().min(1).max(500),
    interruptibility: z.enum(["queued-cancellable", "checkpoint", "atomic"]),
    observedAt: z.string().min(1),
  })
  .strict();
export type JobProgress = z.infer<typeof jobProgressSchema>;

export interface JobSnapshot {
  reference: TaskReference;
  operation: JobOperation;
  state: JobState;
  progress: JobProgress;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequestedAt?: string;
  result?: ResultReference;
  error?: HostError;
}

export interface JobEvent {
  sequence: number;
  job: JobSnapshot;
}

export type JobCreateRequest =
  | {
      operation: "initializeWorkspace";
      input: z.infer<typeof initializeWorkspaceRequestSchema>;
    }
  | {
      operation: "loadWorkspace";
      input: z.infer<typeof workspaceRequestSchema>;
    }
  | {
      operation: "addAsset";
      input: z.infer<typeof addAssetRequestSchema>;
    }
  | {
      operation: "exportWorkspaceOutput";
      input: z.infer<typeof exportWorkspaceOutputRequestSchema>;
    }
  | {
      operation: "matchImageToPackage";
      input: z.infer<typeof imageMatchRequestSchema>;
    }
  | {
      operation: "recordEvent";
      input: z.infer<typeof recordEventRequestSchema>;
    }
  | { operation: "getSignerStatus"; input: Record<string, never> }
  | {
      operation: "createSigner";
      input: z.infer<typeof signerLabelRequestSchema>;
    }
  | {
      operation: "rotateSigner";
      input: z.infer<typeof rotateSignerRequestSchema>;
    }
  | {
      operation: "disableSigner";
      input: z.infer<typeof disableSignerRequestSchema>;
    }
  | {
      operation: "sealPackage";
      input: z.infer<typeof sealPackageRequestSchema>;
    }
  | {
      operation: "verifyPackage" | "inspectPackage";
      input: z.infer<typeof packageRequestSchema>;
    }
  | { operation: "rebuildRecents"; input: Record<string, never> };

export type JobResult =
  | {
      operation: "initializeWorkspace" | "loadWorkspace";
      data: WorkspaceSummary;
    }
  | {
      operation: "addAsset";
      data: { asset: Asset; workspace: Workspace };
    }
  | { operation: "exportWorkspaceOutput"; data: ExportedCreationOutput }
  | { operation: "matchImageToPackage"; data: ImageMatchResult }
  | { operation: "recordEvent"; data: { event: EventRecord } }
  | {
      operation:
        | "getSignerStatus"
        | "createSigner"
        | "rotateSigner"
        | "disableSigner";
      data: LocalSignerStatus;
    }
  | {
      operation: "sealPackage";
      data: {
        package: PackageReference;
        displayPath: string;
        manifest: Record<string, unknown>;
      };
    }
  | { operation: "verifyPackage"; data: VerificationReport }
  | { operation: "inspectPackage"; data: Inspection }
  | { operation: "rebuildRecents"; data: WorkbenchState };

export type JobEventListener = (event: JobEvent) => void;

export interface ProofHostApi {
  getDiagnostics(): Promise<HostEnvelope<HostDiagnostics>>;
  chooseProviderInstallation(): Promise<ProviderInstallationReference | null>;
  inspectProviderInstallation(request: {
    installation: ProviderInstallationReference;
  }): Promise<HostEnvelope<ProviderInstallationSummary>>;
  createCreationSession(request: {
    workspace: WorkspaceReference;
    installation: ProviderInstallationReference;
    title: string;
  }): Promise<HostEnvelope<CreationSessionSummary>>;
  getCreationSessions(request: {
    workspace: WorkspaceReference;
  }): Promise<HostEnvelope<CreationSessionSummary[]>>;
  freezeCreationSession(request: {
    session: CreationSessionReference;
    checkpointObservation: string;
    prompt: string;
    negativePrompt: string;
    promptDisclosure: "included" | "digest-only";
    seed: number;
    parameters: CreationParameters;
  }): Promise<HostEnvelope<CreationSessionSummary>>;
  runCreationSession(request: {
    session: CreationSessionReference;
  }): Promise<HostEnvelope<CreationSessionSummary>>;
  cancelCreationSession(request: {
    session: CreationSessionReference;
  }): Promise<HostEnvelope<CreationSessionSummary>>;
  completeCreationProof(request: {
    session: CreationSessionReference;
    packageOutput: PackageOutputReference;
    reportOutput: ReportOutputReference;
    confirmSignature: true;
  }): Promise<HostEnvelope<CreationSessionSummary>>;
  subscribeCreationEvents(listener: CreationSessionEventListener): () => void;
  chooseWorkspaceParent(): Promise<WorkspaceParentReference | null>;
  chooseExistingWorkspace(): Promise<WorkspaceReference | null>;
  chooseAsset(): Promise<AssetReference | null>;
  chooseImage(): Promise<ImageReference | null>;
  chooseCreationOutput(request: {
    session: CreationSessionReference;
  }): Promise<ImageOutputReference | null>;
  choosePackage(): Promise<PackageReference | null>;
  choosePackageOutput(): Promise<PackageOutputReference | null>;
  chooseTsaProfile(): Promise<TsaProfileReference | null>;
  chooseTimestampPackageOutput(): Promise<TimestampPackageOutputReference | null>;
  chooseReportOutput(): Promise<ReportOutputReference | null>;
  importTsaProfile(request: {
    profile: TsaProfileReference;
  }): Promise<HostEnvelope<TsaProfileSummary>>;
  getTsaProfileStatus(): Promise<HostEnvelope<TsaProfileSummary | null>>;
  requestTrustedTimestamp(request: {
    package: PackageReference;
    output: TimestampPackageOutputReference;
    confirmDisclosure: true;
  }): Promise<
    HostEnvelope<{
      package: PackageReference;
      displayPath: string;
      trustedTime: string;
      disclosure: {
        endpoint: string;
        content_type: "application/timestamp-query";
        message_imprint_sha256: string;
        nonce: string;
        requested_policy: string;
        tsa_profile_sha256: string;
      };
    }>
  >;
  cancelTrustedTimestamp(): Promise<HostEnvelope<{ cancelled: boolean }>>;
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
  exportCreationOutput(request: {
    session: CreationSessionReference;
    output: ImageOutputReference;
  }): Promise<HostEnvelope<ExportedCreationOutput>>;
  matchImageToPackage(request: {
    image: ImageReference;
    package: PackageReference;
  }): Promise<HostEnvelope<ImageMatchResult>>;
  recordEvent(request: {
    workspace: WorkspaceReference;
    eventType: string;
    payloadJson: string;
  }): Promise<HostEnvelope<{ event: EventRecord }>>;
  getSignerStatus(): Promise<HostEnvelope<LocalSignerStatus>>;
  createSigner(request: {
    displayLabel: string;
  }): Promise<HostEnvelope<LocalSignerStatus>>;
  rotateSigner(request: {
    displayLabel: string;
    confirm: true;
  }): Promise<HostEnvelope<LocalSignerStatus>>;
  disableSigner(request: {
    confirm: true;
  }): Promise<HostEnvelope<LocalSignerStatus>>;
  sealPackage(request: {
    workspace: WorkspaceReference;
    output: PackageOutputReference;
    confirmSignature: true;
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
  startJob(request: JobCreateRequest): Promise<HostEnvelope<JobSnapshot>>;
  getJobs(): Promise<HostEnvelope<JobSnapshot[]>>;
  getJobResult(request: {
    result: ResultReference;
  }): Promise<HostEnvelope<JobResult>>;
  cancelJob(request: {
    job: TaskReference;
  }): Promise<HostEnvelope<JobSnapshot>>;
  subscribeJobEvents(listener: JobEventListener): () => void;
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
export const localSignerStatusSchema = z
  .object({
    state: z.enum(["missing", "active", "disabled", "unavailable"]),
    display_label: z.string().min(1).max(200).optional(),
    key_fingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    warning_codes: z.array(z.string()),
  })
  .strict();
export const creatorSignatureDescriptorSchema = z
  .object({
    profile: z.string().min(1),
    signature_id: z.string().regex(/^[0-9a-f]{64}$/u),
    display_label: z.string().min(1).max(200),
    key_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    public_key_path: z.string().regex(/^security\/keys\/[0-9a-f]{64}\.cbor$/u),
    signature_path: z.literal("security/signatures/creator.cose"),
  })
  .strict();
export const trustedTimestampDescriptorSchema = z
  .object({
    profile: z.string().min(1),
    timestamp_path: z
      .string()
      .regex(/^security\/timestamps\/[0-9a-f]{64}\.tsr$/u),
    nonce: z.string().regex(/^[0-9a-f]{32}$/u),
    requested_policy: z.string().min(1),
    tsa_profile_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();
export const tsaProfileSummarySchema = z
  .object({
    profile_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    source_label: z.string().min(1),
    endpoint: z.string().url(),
    endpoint_scope: z.enum(["public_https", "loopback_test"]),
    allowed_policy_oids: z.array(z.string().min(1)).min(1),
    root_count: z.number().int().positive(),
    intermediate_count: z.number().int().nonnegative(),
    https_root_count: z.number().int().nonnegative(),
    revocation_evidence_count: z.number().int().nonnegative(),
    effective_at: z.string().min(1),
    expires_at: z.string().min(1),
  })
  .strict();
export const workspaceSchema = z
  .object({
    workspace_version: z.enum(["0.2.0", "0.3.0", "0.4.0"]),
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
    spec_version: z.enum(["0.2.0", "0.3.0", "0.4.0"]),
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
    creator_signature: creatorSignatureDescriptorSchema.optional(),
    trusted_timestamp: trustedTimestampDescriptorSchema.optional(),
  })
  .strict();
export const timestampAcquisitionResultSchema = z
  .object({
    package: packageReferenceSchema,
    displayPath: localDisplayPath,
    trustedTime: z.string().min(1),
    disclosure: z
      .object({
        endpoint: z.string().url(),
        content_type: z.literal("application/timestamp-query"),
        message_imprint_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
        nonce: z.string().regex(/^[0-9a-f]{32}$/u),
        requested_policy: z.string().min(1),
        tsa_profile_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      })
      .strict(),
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
    reference: diagnosticReferenceSchema,
    hostKind: z.enum(["standalone", "mock", "compatible-host"]),
    workbenchVersion: z.literal(WORKBENCH_VERSION),
    contractVersion: z.literal(HOST_CONTRACT_VERSION),
    nativeApiVersion: semVerSchema,
    engineVersion: semVerSchema,
    protocolVersion: z.literal(PROTOCOL_VERSION),
    supportedProtocolVersions: z.array(semVerSchema).min(1),
    capabilities: z.array(z.string()).min(1),
    execution: nativeDiscoverySchema.shape.execution,
    limits: runtimeLimitsSchema,
    utility: z
      .object({
        state: z.enum([
          "starting",
          "healthy",
          "restarting",
          "stopped",
          "failed",
        ]),
        generation: z.number().int().nonnegative(),
        processId: z.number().int().positive().optional(),
        lastFailureCode: z.string().min(1).optional(),
      })
      .strict(),
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
export const providerInstallationSummarySchema = z
  .object({
    reference: providerInstallationReferenceSchema,
    displayPath: localDisplayPath,
    provider: z.literal(CREATION_PROVIDER_ID),
    detectedVersion: semVerSchema,
    endpoint: z.literal("http://127.0.0.1:8188"),
    compatible: z.literal(true),
    checkpoints: z.array(z.string().min(1).max(512)).min(1).max(1_000),
    customNodeCount: z.number().int().nonnegative(),
    license: z
      .object({
        name: z.literal("GNU General Public License v3.0"),
        spdx: z.literal("GPL-3.0-only"),
        sha256: digestSchema,
      })
      .strict(),
  })
  .strict();
export const creationOutputSummarySchema = z
  .object({
    asset: assetSchema,
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    sha256: digestSchema,
    previewDataUrl: z
      .string()
      .max(512 * 1024)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u)
      .optional(),
  })
  .strict();
export const imageMatchResultSchema = z
  .object({
    status: z.enum([
      "verified_output_match",
      "matched_non_output",
      "not_in_package",
      "package_invalid",
    ]),
    verification: verificationReportSchema,
    image: z
      .object({
        displayLabel: z.string().min(1).max(512),
        displayPath: localDisplayPath,
        mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        sha256: digestSchema.optional(),
        previewDataUrl: z
          .string()
          .max(512 * 1024)
          .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u)
          .optional(),
      })
      .strict(),
    matchedAssets: z.array(assetSchema),
  })
  .strict();
export const exportedCreationOutputSchema = z
  .object({
    image: imageReferenceSchema,
    displayPath: localDisplayPath,
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    sizeBytes: z.number().int().positive(),
    sha256: digestSchema,
  })
  .strict();
export const creationSessionSummarySchema: z.ZodType<CreationSessionSummary> = z
  .object({
    reference: creationSessionReferenceSchema,
    title: z.string().min(1).max(200),
    state: z.enum(creationSessionStates),
    workspace: workspaceReferenceSchema,
    workspaceDisplayPath: localDisplayPath,
    providerInstallation: providerInstallationReferenceSchema,
    providerVersion: semVerSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    snapshot: creationSnapshotSchema.optional(),
    providerJobId: z.string().min(1).max(160).optional(),
    progress: z
      .object({
        completedUnits: z.number().int().min(0).max(100),
        totalUnits: z.literal(100),
        message: z.string().min(1).max(500),
      })
      .strict()
      .optional(),
    output: creationOutputSummarySchema.optional(),
    package: packageReferenceSchema.optional(),
    packageDisplayPath: localDisplayPath.optional(),
    reportDisplayPath: localDisplayPath.optional(),
    verification: verificationReportSchema.optional(),
    error: hostErrorSchema.optional(),
  })
  .strict();
export const creationSessionEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    session: creationSessionSummarySchema,
  })
  .strict();

export const jobCreateRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("initializeWorkspace"),
      input: initializeWorkspaceRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("loadWorkspace"),
      input: workspaceRequestSchema,
    })
    .strict(),
  z
    .object({ operation: z.literal("addAsset"), input: addAssetRequestSchema })
    .strict(),
  z
    .object({
      operation: z.literal("matchImageToPackage"),
      input: imageMatchRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("recordEvent"),
      input: recordEventRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("getSignerStatus"),
      input: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("createSigner"),
      input: signerLabelRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("rotateSigner"),
      input: rotateSignerRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("disableSigner"),
      input: disableSignerRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("sealPackage"),
      input: sealPackageRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("verifyPackage"),
      input: packageRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspectPackage"),
      input: packageRequestSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("rebuildRecents"),
      input: z.object({}).strict(),
    })
    .strict(),
]);

export const jobSnapshotSchema = z
  .object({
    reference: taskReferenceSchema,
    operation: z.enum(jobOperations),
    state: z.enum(jobStates),
    progress: jobProgressSchema,
    createdAt: z.string().min(1),
    startedAt: z.string().min(1).optional(),
    finishedAt: z.string().min(1).optional(),
    cancelRequestedAt: z.string().min(1).optional(),
    result: resultReferenceSchema.optional(),
    error: hostErrorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const terminal = ["succeeded", "failed", "cancelled"].includes(value.state);
    if (terminal !== Boolean(value.finishedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminal job state and finishedAt must agree.",
      });
    }
    if ((value.state === "succeeded") !== Boolean(value.result)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only succeeded jobs expose a result reference.",
      });
    }
    if ((value.state === "failed") !== Boolean(value.error)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only failed jobs expose an error.",
      });
    }
  });
export const jobEventSchema = z
  .object({ sequence: z.number().int().positive(), job: jobSnapshotSchema })
  .strict();

export const jobResultSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("initializeWorkspace"),
      data: workspaceSummarySchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("loadWorkspace"),
      data: workspaceSummarySchema,
    })
    .strict(),
  z
    .object({ operation: z.literal("addAsset"), data: addAssetResultSchema })
    .strict(),
  z
    .object({
      operation: z.literal("exportWorkspaceOutput"),
      data: exportedCreationOutputSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("matchImageToPackage"),
      data: imageMatchResultSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("recordEvent"),
      data: recordEventResultSchema,
    })
    .strict(),
  z
    .object({
      operation: z.enum([
        "getSignerStatus",
        "createSigner",
        "rotateSigner",
        "disableSigner",
      ]),
      data: localSignerStatusSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("sealPackage"),
      data: sealPackageResultSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("verifyPackage"),
      data: verificationReportSchema,
    })
    .strict(),
  z
    .object({ operation: z.literal("inspectPackage"), data: inspectionSchema })
    .strict(),
  z
    .object({
      operation: z.literal("rebuildRecents"),
      data: workbenchStateSchema,
    })
    .strict(),
]);

export const proofHostResponseSchemas = {
  getDiagnostics: hostEnvelopeSchemaFor(hostDiagnosticsSchema),
  chooseProviderInstallation: providerInstallationReferenceSchema.nullable(),
  inspectProviderInstallation: hostEnvelopeSchemaFor(
    providerInstallationSummarySchema,
  ),
  createCreationSession: hostEnvelopeSchemaFor(creationSessionSummarySchema),
  getCreationSessions: hostEnvelopeSchemaFor(
    z.array(creationSessionSummarySchema),
  ),
  freezeCreationSession: hostEnvelopeSchemaFor(creationSessionSummarySchema),
  runCreationSession: hostEnvelopeSchemaFor(creationSessionSummarySchema),
  cancelCreationSession: hostEnvelopeSchemaFor(creationSessionSummarySchema),
  completeCreationProof: hostEnvelopeSchemaFor(creationSessionSummarySchema),
  chooseWorkspaceParent: workspaceParentReferenceSchema.nullable(),
  chooseExistingWorkspace: workspaceReferenceSchema.nullable(),
  chooseAsset: assetReferenceSchema.nullable(),
  chooseImage: imageReferenceSchema.nullable(),
  chooseCreationOutput: imageOutputReferenceSchema.nullable(),
  choosePackage: packageReferenceSchema.nullable(),
  choosePackageOutput: packageOutputReferenceSchema.nullable(),
  chooseTsaProfile: tsaProfileReferenceSchema.nullable(),
  chooseTimestampPackageOutput:
    timestampPackageOutputReferenceSchema.nullable(),
  chooseReportOutput: reportOutputReferenceSchema.nullable(),
  importTsaProfile: hostEnvelopeSchemaFor(tsaProfileSummarySchema),
  getTsaProfileStatus: hostEnvelopeSchemaFor(
    tsaProfileSummarySchema.nullable(),
  ),
  requestTrustedTimestamp: hostEnvelopeSchemaFor(
    timestampAcquisitionResultSchema,
  ),
  cancelTrustedTimestamp: hostEnvelopeSchemaFor(
    z.object({ cancelled: z.boolean() }).strict(),
  ),
  previewWorkspaceTarget: hostEnvelopeSchemaFor(workspaceTargetPreviewSchema),
  initializeWorkspace: hostEnvelopeSchemaFor(workspaceSummarySchema),
  loadWorkspace: hostEnvelopeSchemaFor(workspaceSummarySchema),
  addAsset: hostEnvelopeSchemaFor(addAssetResultSchema),
  exportCreationOutput: hostEnvelopeSchemaFor(exportedCreationOutputSchema),
  matchImageToPackage: hostEnvelopeSchemaFor(imageMatchResultSchema),
  recordEvent: hostEnvelopeSchemaFor(recordEventResultSchema),
  getSignerStatus: hostEnvelopeSchemaFor(localSignerStatusSchema),
  createSigner: hostEnvelopeSchemaFor(localSignerStatusSchema),
  rotateSigner: hostEnvelopeSchemaFor(localSignerStatusSchema),
  disableSigner: hostEnvelopeSchemaFor(localSignerStatusSchema),
  sealPackage: hostEnvelopeSchemaFor(sealPackageResultSchema),
  verifyPackage: hostEnvelopeSchemaFor(verificationReportSchema),
  inspectPackage: hostEnvelopeSchemaFor(inspectionSchema),
  saveReport: hostEnvelopeSchemaFor(saveReportResultSchema),
  getState: hostEnvelopeSchemaFor(workbenchStateSchema),
  setPreference: hostEnvelopeSchemaFor(workbenchStateSchema),
  rebuildRecents: hostEnvelopeSchemaFor(workbenchStateSchema),
  startJob: hostEnvelopeSchemaFor(jobSnapshotSchema),
  getJobs: hostEnvelopeSchemaFor(z.array(jobSnapshotSchema)),
  getJobResult: hostEnvelopeSchemaFor(jobResultSchema),
  cancelJob: hostEnvelopeSchemaFor(jobSnapshotSchema),
  closeApp: z.void(),
} as const;
