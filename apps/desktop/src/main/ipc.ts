import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CreationCoreError,
  createCreationSnapshot,
  mapCreationEvidence,
  transitionCreationSession,
  type ProviderOutput,
  type ProviderObservation,
} from "@aigc-proof/creation-core";
import {
  HOST_CAPABILITIES,
  HOST_CONTRACT_VERSION,
  HostContractError,
  PROTOCOL_VERSION,
  UNAVAILABLE_FEATURES,
  WORKBENCH_VERSION,
  addAssetRequestSchema,
  addAssetResultSchema,
  assetSchema,
  completeCreationProofRequestSchema,
  createCreationSessionRequestSchema,
  creationOutputSummarySchema,
  creationSessionRequestSchema,
  creationSessionSummarySchema,
  creationSnapshotSchema,
  exportCreationOutputRequestSchema,
  exportedCreationOutputSchema,
  freezeCreationSessionRequestSchema,
  hostDiagnosticsSchema,
  hostErrorSchema,
  imageMatchRequestSchema,
  imageMatchResultSchema,
  initializeWorkspaceRequestSchema,
  inspectProviderInstallationRequestSchema,
  inspectionSchema,
  jobCreateRequestSchema,
  packageRequestSchema,
  recordEventRequestSchema,
  recordEventResultSchema,
  resultReferenceSchema,
  saveReportRequestSchema,
  sealPackageRequestSchema,
  setPreferenceRequestSchema,
  taskReferenceSchema,
  verificationReportSchema,
  workspaceRequestSchema,
  workspaceSchema,
  workspaceTargetRequestSchema,
  type DiagnosticReference,
  type CreationSessionReference,
  type CreationSessionSummary,
  type ExportedCreationOutput,
  type HostError,
  type HostEnvelope,
  type JobCreateRequest,
  type JobOperation,
  type JobResult,
  type JobSnapshot,
  type VerificationReport,
  type WorkbenchState,
  type WorkspaceParentReference,
  type WorkspaceSummary,
} from "@aigc-proof/host-contracts";
import { app, dialog, ipcMain, nativeImage, webContents } from "electron";
import { z, type ZodType } from "zod";

import { channels } from "../shared/channels";
import type { UtilityJob } from "../shared/utility-protocol";
import {
  WorkbenchStateStore,
  type StoredCreationSession,
  type StoredWorkbenchState,
} from "./app-state";
import { AuthorityRegistry } from "./authority";
import { ComfyUiSupervisor } from "./comfyui-supervisor";
import { JobScheduler } from "./job-scheduler";
import type { QaSelectionKind, QaSelectionProvider } from "./qa-selections";
import { UtilitySupervisor } from "./utility-supervisor";
import { resolveWorkspaceTarget } from "./workspace-path";

const localPathSchema = z.string().min(1).max(32_767);
const nativeWorkspaceSummarySchema = z
  .object({ path: localPathSchema, workspace: workspaceSchema })
  .strict();
const nativeSealResultSchema = z
  .object({ path: localPathSchema, manifest: z.record(z.unknown()) })
  .strict();
const nativeImageMatchResultSchema = z
  .object({
    status: z.enum([
      "verified_output_match",
      "matched_non_output",
      "not_in_package",
      "package_invalid",
    ]),
    verification: verificationReportSchema,
    file_media_type: z
      .enum(["image/png", "image/jpeg", "image/webp"])
      .optional(),
    file_size_bytes: z.number().int().nonnegative().optional(),
    file_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    matched_assets: z.array(assetSchema),
  })
  .strict();
const nativeExportedOutputSchema = z
  .object({
    path: localPathSchema,
    asset: assetSchema,
    size_bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();
const nativeValidatedRecentsSchema = z
  .object({
    valid: z
      .array(
        z
          .object({
            kind: z.enum(["workspace", "package"]),
            path: localPathSchema,
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

class HostEnvelopeError extends Error {
  constructor(readonly hostError: HostError) {
    super(hostError.message);
    this.name = "HostEnvelopeError";
  }
}

export interface RegisteredIpcRuntime {
  scheduler: JobScheduler;
  stateStore: WorkbenchStateStore;
  close(): Promise<void>;
}

function failure(error: unknown): Extract<HostEnvelope<never>, { ok: false }> {
  if (error instanceof HostEnvelopeError) {
    return { ok: false, error: error.hostError };
  }
  if (error instanceof CreationCoreError) {
    return {
      ok: false,
      error: { code: error.code, kind: "provider", message: error.message },
    };
  }
  if (error instanceof HostContractError) {
    return {
      ok: false,
      error: { code: error.code, kind: "authority", message: error.message },
    };
  }
  return {
    ok: false,
    error: {
      code: "IPC_REQUEST_INVALID",
      kind: "input",
      message:
        error instanceof Error ? error.message : "IPC request was invalid.",
    },
  };
}

function validated<T>(
  schema: ZodType<T>,
  value: unknown,
): T | HostEnvelope<never> {
  try {
    return schema.parse(value);
  } catch (error) {
    return failure(error);
  }
}

function isFailure(value: unknown): value is HostEnvelope<never> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false
  );
}

async function selectedOpenPath(
  qaSelections: QaSelectionProvider | undefined,
  qaKind: QaSelectionKind,
  dialogOptions: Electron.OpenDialogOptions,
): Promise<string | null> {
  if (qaSelections) return qaSelections.take(qaKind);
  const result = await dialog.showOpenDialog(dialogOptions);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function selectedSavePath(
  qaSelections: QaSelectionProvider | undefined,
  qaKind: QaSelectionKind,
  dialogOptions: Electron.SaveDialogOptions,
): Promise<string | null> {
  if (qaSelections) return qaSelections.take(qaKind);
  const result = await dialog.showSaveDialog(dialogOptions);
  return result.canceled ? null : (result.filePath ?? null);
}

async function boundedThumbnailDataUrl(
  selectedPath: string,
): Promise<string | undefined> {
  try {
    const metadata = await fs.lstat(selectedPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return undefined;
    if (metadata.size <= 0 || metadata.size > 100 * 1024 * 1024)
      return undefined;
    const thumbnail = await nativeImage.createThumbnailFromPath(selectedPath, {
      width: 420,
      height: 320,
    });
    if (thumbnail.isEmpty()) return undefined;
    const png = thumbnail.toPNG();
    if (png.byteLength === 0 || png.byteLength > 384 * 1024) return undefined;
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function creationOutputPath(
  workspacePath: string,
  packagePath: string,
): Promise<string | undefined> {
  try {
    const candidate = path.resolve(workspacePath, packagePath);
    const relative = path.relative(workspacePath, candidate);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    )
      return undefined;
    const metadata = await fs.lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return undefined;
    const [workspaceReal, candidateReal] = await Promise.all([
      fs.realpath(workspacePath),
      fs.realpath(candidate),
    ]);
    const realRelative = path.relative(workspaceReal, candidateReal);
    if (
      realRelative === "" ||
      realRelative.startsWith("..") ||
      path.isAbsolute(realRelative)
    )
      return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

async function saveReportNoClobber(
  selectedPath: string,
  report: VerificationReport,
): Promise<HostEnvelope<{ displayPath: string }>> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(selectedPath, "wx");
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    return { ok: true, data: { displayPath: selectedPath } };
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    return {
      ok: false,
      error: {
        code:
          (error as NodeJS.ErrnoException).code === "EEXIST"
            ? "REPORT_ALREADY_EXISTS"
            : "REPORT_SAVE_FAILED",
        kind: "io",
        message:
          error instanceof Error
            ? error.message
            : "Verification report could not be saved.",
        displayPath: selectedPath,
      },
    };
  }
}

export async function registerIpc(
  utility: UtilitySupervisor,
  qaSelections?: QaSelectionProvider,
  qaMode = false,
): Promise<RegisteredIpcRuntime> {
  const discovery = await utility.start();
  const registry = new AuthorityRegistry();
  const scheduler = new JobScheduler(utility);
  const stateStore = new WorkbenchStateStore(
    path.join(app.getPath("userData"), "workbench.sqlite3"),
  );
  stateStore.recoverInterruptedCreationSessions();
  const creationStagingRoot = path.join(
    app.getPath("userData"),
    "creation-staging",
    `run_${randomUUID().replaceAll("-", "")}`,
  );
  await fs.mkdir(creationStagingRoot, { recursive: true });
  const providerSupervisor = new ComfyUiSupervisor(app.getPath("userData"));
  const creationAuthorities = new Map<
    string,
    {
      owner: number;
      sessionId: string;
      reference: CreationSessionReference;
    }
  >();
  const executionPrompts = new Map<
    string,
    { prompt: string; negativePrompt: string }
  >();
  const creationAbortControllers = new Map<string, AbortController>();
  let creationEventSequence = 0;
  const diagnosticReference = Object.freeze({
    id: `ref_${randomUUID().replaceAll("-", "")}`,
    kind: "diagnostic",
    displayLabel: "Workbench 运行诊断",
  }) as DiagnosticReference;

  function resolveCreationSession(
    owner: number,
    raw: CreationSessionReference,
  ): StoredCreationSession {
    const authority = creationAuthorities.get(raw.id);
    if (
      !authority ||
      authority.owner !== owner ||
      authority.reference.kind !== raw.kind ||
      authority.reference.displayLabel !== raw.displayLabel ||
      authority.reference.displayPath !== raw.displayPath
    ) {
      throw new HostContractError(
        "HOST_REFERENCE_UNKNOWN",
        "Creation session reference is unknown, expired, or belongs to another renderer.",
      );
    }
    const session = stateStore.session(authority.sessionId);
    if (!session) {
      throw new HostContractError(
        "CREATION_SESSION_NOT_FOUND",
        "Creation session no longer exists.",
      );
    }
    return session;
  }

  async function publicCreationSession(
    owner: number,
    stored: StoredCreationSession,
  ): Promise<CreationSessionSummary> {
    const existingAuthority = [...creationAuthorities.values()].find(
      (authority) =>
        authority.owner === owner && authority.sessionId === stored.id,
    );
    const reference =
      existingAuthority?.reference ??
      (Object.freeze({
        id: `ref_${randomUUID().replaceAll("-", "")}`,
        kind: "creation-session",
        displayLabel: stored.title,
      }) as CreationSessionReference);
    if (!existingAuthority) {
      creationAuthorities.set(reference.id, {
        owner,
        sessionId: stored.id,
        reference,
      });
    }
    const workspace = await registry.issue(
      "workspace",
      stored.workspacePath,
      owner,
      [
        "loadWorkspace",
        "addAsset",
        "recordEvent",
        "sealPackage",
        "exportWorkspaceOutput",
      ],
    );
    const providerInstallation = await registry.issue(
      "provider-installation",
      stored.providerPath,
      owner,
      ["inspectProviderInstallation", "createCreationSession"],
    );
    const outputRecord = stored.outputJson
      ? creationOutputSummarySchema.parse(JSON.parse(stored.outputJson))
      : undefined;
    const outputAsset = outputRecord?.asset;
    const outputSource = outputAsset
      ? await creationOutputPath(stored.workspacePath, outputAsset.package_path)
      : undefined;
    const outputPreview = outputSource
      ? await boundedThumbnailDataUrl(outputSource)
      : undefined;
    const packageReference = stored.packagePath
      ? await registry.issue("package", stored.packagePath, owner, [
          "verifyPackage",
          "inspectPackage",
          "matchImageToPackage",
        ])
      : undefined;
    return creationSessionSummarySchema.parse({
      reference,
      title: stored.title,
      state: stored.state,
      workspace,
      workspaceDisplayPath: stored.workspacePath,
      providerInstallation,
      providerVersion: stored.providerVersion,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      ...(stored.snapshotJson
        ? {
            snapshot: creationSnapshotSchema.parse(
              JSON.parse(stored.snapshotJson),
            ),
          }
        : {}),
      ...(stored.providerJobId ? { providerJobId: stored.providerJobId } : {}),
      ...(stored.progressJson
        ? { progress: JSON.parse(stored.progressJson) }
        : {}),
      ...(outputAsset
        ? {
            output: {
              asset: outputAsset,
              mediaType: outputRecord.mediaType,
              sizeBytes: outputRecord.sizeBytes,
              sha256: outputRecord.sha256,
              ...(outputPreview ? { previewDataUrl: outputPreview } : {}),
            },
          }
        : {}),
      ...(packageReference ? { package: packageReference } : {}),
      ...(stored.packagePath ? { packageDisplayPath: stored.packagePath } : {}),
      ...(stored.reportPath ? { reportDisplayPath: stored.reportPath } : {}),
      ...(stored.verificationJson
        ? {
            verification: verificationReportSchema.parse(
              JSON.parse(stored.verificationJson),
            ),
          }
        : {}),
      ...(stored.errorJson
        ? { error: hostErrorSchema.parse(JSON.parse(stored.errorJson)) }
        : {}),
    });
  }

  async function publishCreationEvent(
    owner: number,
    stored: StoredCreationSession,
  ): Promise<CreationSessionSummary> {
    const session = await publicCreationSession(owner, stored);
    webContents.fromId(owner)?.send(channels.creationEvent, {
      sequence: ++creationEventSequence,
      session,
    });
    return session;
  }

  async function publicState(
    owner: number,
    state: StoredWorkbenchState,
  ): Promise<WorkbenchState> {
    const issueRecent = async <K extends "workspace" | "package">(
      kind: K,
      items: StoredWorkbenchState[K extends "workspace"
        ? "recentWorkspaces"
        : "recentPackages"],
    ) => {
      const converted = await Promise.all(
        items.map(async (item) => {
          try {
            return {
              reference: await registry.issue(
                kind,
                item.path,
                owner,
                kind === "workspace"
                  ? [
                      "loadWorkspace",
                      "addAsset",
                      "recordEvent",
                      "sealPackage",
                      "exportWorkspaceOutput",
                    ]
                  : ["verifyPackage", "inspectPackage", "matchImageToPackage"],
              ),
              displayPath: item.path,
              lastOpenedAt: item.lastOpenedAt,
            };
          } catch {
            return undefined;
          }
        }),
      );
      return converted.filter((item) => item !== undefined);
    };
    return {
      schemaVersion: state.schemaVersion,
      preferences: state.preferences,
      recentWorkspaces: await issueRecent("workspace", state.recentWorkspaces),
      recentPackages: await issueRecent("package", state.recentPackages),
    };
  }

  async function publishWorkspace(
    owner: number,
    raw: unknown,
  ): Promise<WorkspaceSummary> {
    const native = nativeWorkspaceSummarySchema.parse(raw);
    stateStore.remember("workspace", native.path);
    return {
      reference: await registry.issue("workspace", native.path, owner, [
        "loadWorkspace",
        "addAsset",
        "recordEvent",
        "sealPackage",
        "exportWorkspaceOutput",
      ]),
      displayPath: native.path,
      workspace: native.workspace,
    };
  }

  async function startAuthorizedJob(
    owner: number,
    request: JobCreateRequest,
  ): Promise<HostEnvelope<JobSnapshot>> {
    try {
      let utilityJob: UtilityJob;
      let publish: (raw: unknown) => Promise<JobResult>;
      const oneUse: Array<{
        raw: unknown;
        kind: "asset" | "image" | "image-output" | "package-output";
        permission: string;
      }> = [];
      switch (request.operation) {
        case "initializeWorkspace": {
          const parent = await registry.resolve(
            request.input.parent,
            "workspace-parent",
            owner,
            "initializeWorkspace",
          );
          const target = await resolveWorkspaceTarget(
            parent,
            request.input.folderName,
          );
          if (!target.ok) return target;
          if (target.data.exists) {
            return {
              ok: false,
              error: {
                code: "WORKSPACE_ALREADY_EXISTS",
                kind: "output_already_exists",
                message:
                  "目标已存在。若它是有效工作区，请使用“打开已有工作区”。",
                displayPath: target.data.displayPath,
              },
            };
          }
          utilityJob = {
            operation: "initializeWorkspace",
            payload: {
              path: target.data.displayPath,
              ...(request.input.projectName
                ? { projectName: request.input.projectName }
                : {}),
            },
          };
          publish = async (raw) => ({
            operation: "initializeWorkspace",
            data: await publishWorkspace(owner, raw),
          });
          break;
        }
        case "loadWorkspace": {
          const selected = await registry.resolve(
            request.input.workspace,
            "workspace",
            owner,
            "loadWorkspace",
          );
          utilityJob = {
            operation: "loadWorkspace",
            payload: { path: selected },
          };
          publish = async (raw) => ({
            operation: "loadWorkspace",
            data: await publishWorkspace(owner, raw),
          });
          break;
        }
        case "addAsset": {
          const workspace = await registry.resolve(
            request.input.workspace,
            "workspace",
            owner,
            "addAsset",
          );
          const source = await registry.resolve(
            request.input.source,
            "asset",
            owner,
            "addAsset",
          );
          utilityJob = {
            operation: "addAsset",
            payload: { workspace, source, role: request.input.role },
          };
          oneUse.push({
            raw: request.input.source,
            kind: "asset",
            permission: "addAsset",
          });
          publish = async (raw) => ({
            operation: "addAsset",
            data: addAssetResultSchema.parse(raw),
          });
          break;
        }
        case "exportWorkspaceOutput": {
          const workspace = await registry.resolve(
            request.input.workspace,
            "workspace",
            owner,
            "exportWorkspaceOutput",
          );
          const output = await registry.resolve(
            request.input.output,
            "image-output",
            owner,
            "exportWorkspaceOutput",
          );
          utilityJob = {
            operation: "exportWorkspaceOutput",
            payload: {
              workspace,
              assetId: request.input.assetId,
              output,
            },
          };
          oneUse.push({
            raw: request.input.output,
            kind: "image-output",
            permission: "exportWorkspaceOutput",
          });
          publish = async (raw) => {
            const native = nativeExportedOutputSchema.parse(raw);
            const mediaType = assetSchema.parse(native.asset).media_type;
            const result: ExportedCreationOutput = {
              image: await registry.issue(
                "image",
                native.path,
                owner,
                ["matchImageToPackage"],
                undefined,
                undefined,
                true,
              ),
              displayPath: native.path,
              mediaType: z
                .enum(["image/png", "image/jpeg", "image/webp"])
                .parse(mediaType),
              sizeBytes: native.size_bytes,
              sha256: native.sha256,
            };
            return {
              operation: "exportWorkspaceOutput",
              data: exportedCreationOutputSchema.parse(result),
            };
          };
          break;
        }
        case "matchImageToPackage": {
          const selectedPackage = await registry.resolve(
            request.input.package,
            "package",
            owner,
            "matchImageToPackage",
          );
          const selectedImage = await registry.resolve(
            request.input.image,
            "image",
            owner,
            "matchImageToPackage",
          );
          utilityJob = {
            operation: "matchImageToPackage",
            payload: { package: selectedPackage, image: selectedImage },
          };
          oneUse.push({
            raw: request.input.image,
            kind: "image",
            permission: "matchImageToPackage",
          });
          publish = async (raw) => {
            const native = nativeImageMatchResultSchema.parse(raw);
            stateStore.remember("package", selectedPackage);
            const previewDataUrl = native.file_media_type
              ? await boundedThumbnailDataUrl(selectedImage)
              : undefined;
            const result = {
              status: native.status,
              verification: native.verification,
              image: {
                displayLabel: request.input.image.displayLabel,
                displayPath: selectedImage,
                ...(native.file_media_type
                  ? { mediaType: native.file_media_type }
                  : {}),
                ...(native.file_size_bytes !== undefined
                  ? { sizeBytes: native.file_size_bytes }
                  : {}),
                ...(native.file_sha256 ? { sha256: native.file_sha256 } : {}),
                ...(previewDataUrl ? { previewDataUrl } : {}),
              },
              matchedAssets: native.matched_assets,
            };
            return {
              operation: "matchImageToPackage",
              data: imageMatchResultSchema.parse(result),
            };
          };
          break;
        }
        case "recordEvent": {
          const workspace = await registry.resolve(
            request.input.workspace,
            "workspace",
            owner,
            "recordEvent",
          );
          utilityJob = {
            operation: "recordEvent",
            payload: {
              workspace,
              eventType: request.input.eventType,
              payloadJson: request.input.payloadJson,
            },
          };
          publish = async (raw) => ({
            operation: "recordEvent",
            data: recordEventResultSchema.parse(raw),
          });
          break;
        }
        case "sealPackage": {
          const workspace = await registry.resolve(
            request.input.workspace,
            "workspace",
            owner,
            "sealPackage",
          );
          const output = await registry.resolve(
            request.input.output,
            "package-output",
            owner,
            "sealPackage",
          );
          utilityJob = {
            operation: "sealPackage",
            payload: { workspace, output },
          };
          oneUse.push({
            raw: request.input.output,
            kind: "package-output",
            permission: "sealPackage",
          });
          publish = async (raw) => {
            const native = nativeSealResultSchema.parse(raw);
            stateStore.remember("package", native.path);
            return {
              operation: "sealPackage",
              data: {
                package: await registry.issue("package", native.path, owner, [
                  "verifyPackage",
                  "inspectPackage",
                  "matchImageToPackage",
                ]),
                displayPath: native.path,
                manifest: native.manifest,
              },
            };
          };
          break;
        }
        case "verifyPackage":
        case "inspectPackage": {
          const operation = request.operation;
          const selected = await registry.resolve(
            request.input.package,
            "package",
            owner,
            operation,
          );
          utilityJob = { operation, payload: { path: selected } };
          publish = async (raw) => {
            stateStore.remember("package", selected);
            return operation === "verifyPackage"
              ? { operation, data: verificationReportSchema.parse(raw) }
              : { operation, data: inspectionSchema.parse(raw) };
          };
          break;
        }
        case "rebuildRecents": {
          utilityJob = {
            operation: "validateRecents",
            payload: {
              items: stateStore
                .candidates()
                .map((item) => ({ kind: item.kind, path: item.path })),
            },
          };
          publish = async (raw) => {
            const validatedRecents = nativeValidatedRecentsSchema.parse(raw);
            return {
              operation: "rebuildRecents",
              data: await publicState(
                owner,
                stateStore.publishValidated(validatedRecents.valid),
              ),
            };
          };
          break;
        }
      }
      const queued = scheduler.enqueue(
        owner,
        request.operation,
        utilityJob,
        publish,
      );
      if (queued.ok) {
        for (const selected of oneUse) {
          registry.consume(
            selected.raw,
            selected.kind,
            owner,
            selected.permission,
          );
        }
      }
      return queued;
    } catch (error) {
      return failure(error);
    }
  }

  async function legacy(
    owner: number,
    request: JobCreateRequest,
  ): Promise<HostEnvelope<unknown>> {
    const started = await startAuthorizedJob(owner, request);
    if (!started.ok) return started;
    const result = await scheduler.wait(owner, started.data.reference);
    return result.ok ? { ok: true, data: result.data.data } : result;
  }

  ipcMain.handle(channels.getDiagnostics, () => ({
    ok: true,
    data: hostDiagnosticsSchema.parse({
      reference: diagnosticReference,
      hostKind: "standalone",
      workbenchVersion: WORKBENCH_VERSION,
      contractVersion: HOST_CONTRACT_VERSION,
      nativeApiVersion: discovery.apiVersion,
      engineVersion: discovery.engineVersion,
      protocolVersion: PROTOCOL_VERSION,
      supportedProtocolVersions: discovery.supportedProtocolVersions,
      capabilities: [...HOST_CAPABILITIES],
      execution: discovery.execution,
      limits: discovery.limits,
      utility: utility.health(),
      unavailableFeatures: [...UNAVAILABLE_FEATURES],
    }),
  }));

  ipcMain.handle(channels.chooseProviderInstallation, async (event) => {
    const selected = await selectedOpenPath(
      qaSelections,
      "providerInstallations",
      {
        title: "选择本地 ComfyUI portable 安装目录",
        buttonLabel: "选择 ComfyUI",
        properties: ["openDirectory"],
      },
    );
    return selected
      ? registry.issue("provider-installation", selected, event.sender.id, [
          "inspectProviderInstallation",
          "createCreationSession",
        ])
      : null;
  });

  ipcMain.handle(
    channels.inspectProviderInstallation,
    async (event, raw: unknown) => {
      const request = validated(inspectProviderInstallationRequestSchema, raw);
      if (isFailure(request)) return request;
      try {
        const selected = await registry.resolve(
          request.installation,
          "provider-installation",
          event.sender.id,
          "inspectProviderInstallation",
        );
        const inspection = await providerSupervisor.inspect(selected);
        stateStore.rememberProvider({
          path: inspection.installationPath,
          detectedVersion: inspection.version,
          licenseSha256: inspection.licenseSha256,
          checkpoints: inspection.checkpoints,
          customNodeCount: inspection.customNodeCount,
          lastInspectedAt: new Date().toISOString(),
        });
        return {
          ok: true,
          data: {
            reference: request.installation,
            displayPath: inspection.installationPath,
            provider: "comfyui-local",
            detectedVersion: inspection.version,
            endpoint: "http://127.0.0.1:8188",
            compatible: true,
            checkpoints: inspection.checkpoints,
            customNodeCount: inspection.customNodeCount,
            license: {
              name: "GNU General Public License v3.0",
              spdx: "GPL-3.0-only",
              sha256: inspection.licenseSha256,
            },
          },
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    channels.createCreationSession,
    async (event, raw: unknown) => {
      const request = validated(createCreationSessionRequestSchema, raw);
      if (isFailure(request)) return request;
      try {
        const workspacePath = await registry.resolve(
          request.workspace,
          "workspace",
          event.sender.id,
          "addAsset",
        );
        const providerPath = await registry.resolve(
          request.installation,
          "provider-installation",
          event.sender.id,
          "createCreationSession",
        );
        const canonicalProviderPath = await fs.realpath(providerPath);
        const provider = stateStore
          .providers()
          .find((item) => item.path === canonicalProviderPath);
        if (!provider) {
          throw new CreationCoreError(
            "PROVIDER_INSTALLATION_INVALID",
            "Inspect and approve the ComfyUI installation before creating a session.",
          );
        }
        const now = new Date().toISOString();
        const session = stateStore.createSession({
          id: `session_${randomUUID().replaceAll("-", "")}`,
          title: request.title,
          state: "draft",
          workspacePath,
          providerPath: provider.path,
          providerVersion: provider.detectedVersion,
          createdAt: now,
          updatedAt: now,
        });
        return {
          ok: true,
          data: await publishCreationEvent(event.sender.id, session),
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(channels.getCreationSessions, async (event) => {
    try {
      return {
        ok: true,
        data: await Promise.all(
          stateStore
            .sessions()
            .map((session) => publicCreationSession(event.sender.id, session)),
        ),
      };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    channels.freezeCreationSession,
    async (event, raw: unknown) => {
      const request = validated(freezeCreationSessionRequestSchema, raw);
      if (isFailure(request)) return request;
      try {
        const session = resolveCreationSession(
          event.sender.id,
          request.session,
        );
        if (session.state !== "draft") {
          throw new CreationCoreError(
            "CREATION_STATE_INVALID",
            "Only a draft session can freeze its immutable creation snapshot.",
          );
        }
        const provider = stateStore
          .providers()
          .find((item) => item.path === session.providerPath);
        if (!provider?.checkpoints.includes(request.checkpointObservation)) {
          throw new CreationCoreError(
            "CREATION_RELATIONSHIP_INVALID",
            "Selected checkpoint was not reported by the approved provider inspection.",
          );
        }
        const snapshot = createCreationSnapshot({
          providerVersion: session.providerVersion,
          checkpointObservation: request.checkpointObservation,
          seed: request.seed,
          parameters: request.parameters,
          promptDisclosure: request.promptDisclosure,
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
        });
        executionPrompts.set(session.id, {
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
        });
        const updated = stateStore.updateSession(session.id, {
          state: transitionCreationSession(session.state, "freeze"),
          snapshotJson: JSON.stringify(snapshot),
          errorJson: undefined,
          progressJson: JSON.stringify({
            completedUnits: 0,
            totalUnits: 100,
            message: "创建快照已冻结，等待本地生成。",
          }),
        });
        return {
          ok: true,
          data: await publishCreationEvent(event.sender.id, updated),
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(channels.runCreationSession, async (event, raw: unknown) => {
    const request = validated(creationSessionRequestSchema, raw);
    if (isFailure(request)) return request;
    let session: StoredCreationSession | undefined;
    let stagingPath: string | undefined;
    try {
      session = resolveCreationSession(event.sender.id, request.session);
      if (
        !["frozen", "failed", "cancelled"].includes(session.state) ||
        !session.snapshotJson ||
        session.outputJson
      ) {
        throw new CreationCoreError(
          "CREATION_STATE_INVALID",
          "Session must have one frozen snapshot and no successful output before it can run.",
        );
      }
      const snapshot = creationSnapshotSchema.parse(
        JSON.parse(session.snapshotJson),
      );
      const prompts =
        snapshot.prompt_disclosure === "included"
          ? {
              prompt: snapshot.prompt!,
              negativePrompt: snapshot.negative_prompt!,
            }
          : executionPrompts.get(session.id);
      if (!prompts) {
        throw new CreationCoreError(
          "CREATION_STATE_INVALID",
          "Digest-only prompts are intentionally not persisted; re-create the session after an app restart.",
        );
      }
      const inspection = await providerSupervisor.inspect(session.providerPath);
      if (
        inspection.version !== session.providerVersion ||
        !inspection.checkpoints.includes(snapshot.checkpoint_observation)
      ) {
        throw new CreationCoreError(
          "CREATION_RELATIONSHIP_INVALID",
          "Provider version or checkpoint changed after the snapshot was frozen.",
        );
      }
      const controller = new AbortController();
      creationAbortControllers.set(session.id, controller);
      let providerJobId: string | undefined;
      const observe = (observation: ProviderObservation) => {
        if (!session) return;
        if ("providerJobId" in observation && observation.providerJobId) {
          providerJobId = observation.providerJobId;
        }
        const completedUnits =
          observation.state === "progress"
            ? Math.min(95, observation.completedUnits)
            : observation.state === "accepted"
              ? 5
              : observation.state === "running"
                ? 10
                : observation.state === "completed"
                  ? 95
                  : 0;
        const current = stateStore.updateSession(session.id, {
          state:
            observation.state === "cancelled"
              ? "cancelled"
              : observation.state === "failed"
                ? "failed"
                : "running",
          ...(providerJobId ? { providerJobId } : {}),
          progressJson: JSON.stringify({
            completedUnits,
            totalUnits: 100,
            message: `ComfyUI: ${observation.state}`,
          }),
        });
        void publishCreationEvent(event.sender.id, current);
      };
      session = stateStore.updateSession(session.id, {
        state: transitionCreationSession(session.state, "start"),
        errorJson: undefined,
        progressJson: JSON.stringify({
          completedUnits: 1,
          totalUnits: 100,
          message: "正在提交固定核心节点工作流。",
        }),
      });
      await publishCreationEvent(event.sender.id, session);
      const output: ProviderOutput = await providerSupervisor.adapter().run(
        {
          clientId: `client_${randomUUID().replaceAll("-", "")}`,
          snapshot,
          filenamePrefix: `ap_${session.id.slice("session_".length, 25)}`,
          ...prompts,
        },
        observe,
        controller.signal,
      );
      if (controller.signal.aborted) {
        throw new CreationCoreError(
          "PROVIDER_CANCELLED",
          "Provider job was cancelled before output ingestion.",
        );
      }
      session = stateStore.updateSession(session.id, {
        state: transitionCreationSession("running", "provider_succeeded"),
        ...(providerJobId ? { providerJobId } : {}),
        progressJson: JSON.stringify({
          completedUnits: 95,
          totalUnits: 100,
          message: "Provider 已完成；正在校验并自动接入输出。",
        }),
      });
      await publishCreationEvent(event.sender.id, session);
      const extension =
        output.mediaType === "image/png"
          ? ".png"
          : output.mediaType === "image/jpeg"
            ? ".jpg"
            : ".webp";
      const stagingDirectory = path.join(creationStagingRoot, session.id);
      await fs.mkdir(stagingDirectory, { recursive: true });
      stagingPath = path.join(stagingDirectory, `${output.sha256}${extension}`);
      const handle = await fs.open(stagingPath, "wx");
      try {
        await handle.writeFile(output.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const source = await registry.issue(
        "asset",
        stagingPath,
        event.sender.id,
        ["addAsset"],
        output.filename,
        undefined,
        true,
      );
      const workspace = await registry.issue(
        "workspace",
        session.workspacePath,
        event.sender.id,
        [
          "loadWorkspace",
          "addAsset",
          "recordEvent",
          "sealPackage",
          "exportWorkspaceOutput",
        ],
      );
      const ingested = await legacy(event.sender.id, {
        operation: "addAsset",
        input: { workspace, source, role: "output" },
      });
      if (!ingested.ok) throw new HostEnvelopeError(ingested.error);
      const assetResult = addAssetResultSchema.parse(ingested.data);
      const descriptor = {
        filename: output.filename,
        subfolder: output.subfolder,
        type: output.type,
        mediaType: output.mediaType,
        sizeBytes: output.sizeBytes,
        sha256: output.sha256,
      };
      const evidence = mapCreationEvidence({
        sessionId: session.id,
        sessionState: session.state,
        snapshot,
        providerJobId: providerJobId ?? "unknown-provider-job",
        output: descriptor,
      });
      for (const item of evidence) {
        const recorded = await legacy(event.sender.id, {
          operation: "recordEvent",
          input: {
            workspace,
            eventType: item.eventType,
            payloadJson: JSON.stringify(item.payload),
          },
        });
        if (!recorded.ok) throw new HostEnvelopeError(recorded.error);
      }
      await fs.unlink(stagingPath).catch(() => undefined);
      await fs.rmdir(stagingDirectory).catch(() => undefined);
      stagingPath = undefined;
      session = stateStore.updateSession(session.id, {
        state: transitionCreationSession(session.state, "evidence_ready"),
        ...(providerJobId ? { providerJobId } : {}),
        outputJson: JSON.stringify({
          asset: assetResult.asset,
          mediaType: output.mediaType,
          sizeBytes: output.sizeBytes,
          sha256: output.sha256,
        }),
        progressJson: JSON.stringify({
          completedUnits: 100,
          totalUnits: 100,
          message: "输出已自动加入工作区，创建证据链已就绪。",
        }),
      });
      return {
        ok: true,
        data: await publishCreationEvent(event.sender.id, session),
      };
    } catch (error) {
      if (session) {
        const host = failure(error).error;
        const cancelled =
          error instanceof CreationCoreError &&
          error.code === "PROVIDER_CANCELLED";
        const updated = stateStore.updateSession(session.id, {
          state: cancelled ? "cancelled" : "failed",
          errorJson: JSON.stringify(host),
          progressJson: JSON.stringify({
            completedUnits: 0,
            totalUnits: 100,
            message: cancelled
              ? "创建任务已取消，未生成成功输出证明。"
              : `创建失败：[${host.code}] ${host.message}`,
          }),
        });
        await publishCreationEvent(event.sender.id, updated).catch(
          () => undefined,
        );
      }
      if (stagingPath) await fs.unlink(stagingPath).catch(() => undefined);
      return failure(error);
    } finally {
      if (session) creationAbortControllers.delete(session.id);
    }
  });

  ipcMain.handle(
    channels.cancelCreationSession,
    async (event, raw: unknown) => {
      const request = validated(creationSessionRequestSchema, raw);
      if (isFailure(request)) return request;
      try {
        const session = resolveCreationSession(
          event.sender.id,
          request.session,
        );
        if (session.state !== "running") {
          throw new CreationCoreError(
            "CREATION_STATE_INVALID",
            "Only a running creation session can be cancelled.",
          );
        }
        creationAbortControllers.get(session.id)?.abort();
        const updated = stateStore.updateSession(session.id, {
          state: transitionCreationSession(session.state, "cancel"),
          progressJson: JSON.stringify({
            completedUnits: 0,
            totalUnits: 100,
            message: "已请求取消；不会发布成功输出证明。",
          }),
        });
        return {
          ok: true,
          data: await publishCreationEvent(event.sender.id, updated),
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    channels.completeCreationProof,
    async (event, raw: unknown) => {
      const request = validated(completeCreationProofRequestSchema, raw);
      if (isFailure(request)) return request;
      try {
        const session = resolveCreationSession(
          event.sender.id,
          request.session,
        );
        if (session.state !== "proof_ready" || !session.outputJson) {
          throw new CreationCoreError(
            "CREATION_STATE_INVALID",
            "Only a successful automatically ingested creation can be sealed.",
          );
        }
        const reportPath = await registry.resolve(
          request.reportOutput,
          "report-output",
          event.sender.id,
          "saveReport",
        );
        if (await fs.stat(reportPath).catch(() => undefined)) {
          return {
            ok: false,
            error: {
              code: "REPORT_ALREADY_EXISTS",
              kind: "output_already_exists",
              message: "报告输出已存在；请选择新的目标。",
              displayPath: reportPath,
            },
          };
        }
        const workspace = await registry.issue(
          "workspace",
          session.workspacePath,
          event.sender.id,
          [
            "loadWorkspace",
            "addAsset",
            "recordEvent",
            "sealPackage",
            "exportWorkspaceOutput",
          ],
        );
        const sealed = await legacy(event.sender.id, {
          operation: "sealPackage",
          input: { workspace, output: request.packageOutput },
        });
        if (!sealed.ok) return sealed;
        const sealedData = sealed.data as {
          package: import("@aigc-proof/host-contracts").PackageReference;
          displayPath: string;
          manifest: Record<string, unknown>;
        };
        const verified = await legacy(event.sender.id, {
          operation: "verifyPackage",
          input: { package: sealedData.package },
        });
        if (!verified.ok) return verified;
        const report = verificationReportSchema.parse(verified.data);
        const saved = await saveReportNoClobber(reportPath, report);
        if (!saved.ok) return saved;
        registry.consume(
          request.reportOutput,
          "report-output",
          event.sender.id,
          "saveReport",
        );
        const updated = stateStore.updateSession(session.id, {
          state: transitionCreationSession(session.state, "proof_complete"),
          packagePath: sealedData.displayPath,
          reportPath,
          verificationJson: JSON.stringify(report),
          progressJson: JSON.stringify({
            completedUnits: 100,
            totalUnits: 100,
            message: "证明包已封装、独立验证并保存报告。",
          }),
        });
        return {
          ok: true,
          data: await publishCreationEvent(event.sender.id, updated),
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(channels.chooseWorkspaceParent, async (event) => {
    const selected = await selectedOpenPath(qaSelections, "workspaceParents", {
      title: "选择新工作区的父文件夹",
      buttonLabel: "选择父文件夹",
      properties: ["openDirectory"],
    });
    return selected
      ? registry.issue("workspace-parent", selected, event.sender.id, [
          "previewWorkspaceTarget",
          "initializeWorkspace",
        ])
      : null;
  });
  ipcMain.handle(channels.chooseExistingWorkspace, async (event) => {
    const selected = await selectedOpenPath(
      qaSelections,
      "existingWorkspaces",
      {
        title: "选择已有 AIGC-Proof 工作区",
        buttonLabel: "打开工作区",
        properties: ["openDirectory"],
      },
    );
    return selected
      ? registry.issue("workspace", selected, event.sender.id, [
          "loadWorkspace",
          "addAsset",
          "recordEvent",
          "sealPackage",
          "exportWorkspaceOutput",
        ])
      : null;
  });
  ipcMain.handle(channels.chooseAsset, async (event) => {
    const selected = await selectedOpenPath(qaSelections, "assets", {
      properties: ["openFile"],
    });
    return selected
      ? registry.issue(
          "asset",
          selected,
          event.sender.id,
          ["addAsset"],
          undefined,
          undefined,
          true,
        )
      : null;
  });
  ipcMain.handle(channels.chooseImage, async (event) => {
    const selected = await selectedOpenPath(qaSelections, "images", {
      title: "选择要与证明包核验的图片",
      buttonLabel: "选择图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    return selected
      ? registry.issue(
          "image",
          selected,
          event.sender.id,
          ["matchImageToPackage"],
          undefined,
          undefined,
          true,
        )
      : null;
  });
  ipcMain.handle(channels.chooseCreationOutput, async (event, raw: unknown) => {
    const request = validated(creationSessionRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const session = resolveCreationSession(event.sender.id, request.session);
      const outputRecord = session.outputJson
        ? (JSON.parse(session.outputJson) as Record<string, unknown>)
        : undefined;
      const mediaType = z
        .enum(["image/png", "image/jpeg", "image/webp"])
        .parse(outputRecord?.mediaType);
      const extension =
        mediaType === "image/png"
          ? "png"
          : mediaType === "image/jpeg"
            ? "jpg"
            : "webp";
      const selected = await selectedSavePath(qaSelections, "imageOutputs", {
        title: "保存生成图片副本",
        buttonLabel: "保存图片",
        filters: [{ name: "生成图片", extensions: [extension] }],
      });
      return selected
        ? registry.issue(
            "image-output",
            selected,
            event.sender.id,
            ["exportWorkspaceOutput"],
            undefined,
            undefined,
            true,
          )
        : null;
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.choosePackage, async (event) => {
    const selected = await selectedOpenPath(qaSelections, "packages", {
      properties: ["openFile"],
      filters: [{ name: "AIGC-Proof", extensions: ["aigcproof"] }],
    });
    return selected
      ? registry.issue("package", selected, event.sender.id, [
          "verifyPackage",
          "inspectPackage",
          "matchImageToPackage",
        ])
      : null;
  });
  ipcMain.handle(channels.choosePackageOutput, async (event) => {
    const selected = await selectedSavePath(qaSelections, "packageOutputs", {
      filters: [{ name: "AIGC-Proof", extensions: ["aigcproof"] }],
    });
    return selected
      ? registry.issue(
          "package-output",
          selected,
          event.sender.id,
          ["sealPackage"],
          undefined,
          undefined,
          true,
        )
      : null;
  });
  ipcMain.handle(channels.chooseReportOutput, async (event) => {
    const selected = await selectedSavePath(qaSelections, "reportOutputs", {
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return selected
      ? registry.issue(
          "report-output",
          selected,
          event.sender.id,
          ["saveReport"],
          undefined,
          undefined,
          true,
        )
      : null;
  });

  ipcMain.handle(
    channels.previewWorkspaceTarget,
    async (event, raw: unknown) => {
      const request = validated(workspaceTargetRequestSchema, raw);
      if (isFailure(request)) return request;
      try {
        const parent = await registry.resolve(
          request.parent,
          "workspace-parent",
          event.sender.id,
          "previewWorkspaceTarget",
        );
        const target = await resolveWorkspaceTarget(parent, request.folderName);
        return target.ok
          ? {
              ok: true,
              data: {
                parent: request.parent as WorkspaceParentReference,
                folderName: request.folderName,
                displayPath: target.data.displayPath,
                exists: target.data.exists,
              },
            }
          : target;
      } catch (error) {
        return failure(error);
      }
    },
  );

  const registerLegacy = <T>(
    channel: string,
    operation: JobOperation,
    schema: ZodType<T>,
  ) => {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      const input = validated(schema, raw);
      if (isFailure(input)) return input;
      return legacy(event.sender.id, { operation, input } as JobCreateRequest);
    });
  };
  registerLegacy(
    channels.initializeWorkspace,
    "initializeWorkspace",
    initializeWorkspaceRequestSchema,
  );
  registerLegacy(
    channels.loadWorkspace,
    "loadWorkspace",
    workspaceRequestSchema,
  );
  registerLegacy(channels.addAsset, "addAsset", addAssetRequestSchema);
  registerLegacy(
    channels.matchImageToPackage,
    "matchImageToPackage",
    imageMatchRequestSchema,
  );
  registerLegacy(channels.recordEvent, "recordEvent", recordEventRequestSchema);
  registerLegacy(channels.sealPackage, "sealPackage", sealPackageRequestSchema);
  registerLegacy(channels.verifyPackage, "verifyPackage", packageRequestSchema);
  registerLegacy(
    channels.inspectPackage,
    "inspectPackage",
    packageRequestSchema,
  );

  ipcMain.handle(channels.exportCreationOutput, async (event, raw: unknown) => {
    const request = validated(exportCreationOutputRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const session = resolveCreationSession(event.sender.id, request.session);
      const outputRecord = session.outputJson
        ? (JSON.parse(session.outputJson) as Record<string, unknown>)
        : undefined;
      const asset = assetSchema.parse(outputRecord?.asset);
      if (asset.role !== "output") {
        throw new CreationCoreError(
          "CREATION_RELATIONSHIP_INVALID",
          "Creation session output is not recorded with role output.",
        );
      }
      const workspace = await registry.issue(
        "workspace",
        session.workspacePath,
        event.sender.id,
        ["exportWorkspaceOutput"],
      );
      return legacy(event.sender.id, {
        operation: "exportWorkspaceOutput",
        input: {
          workspace,
          assetId: asset.asset_id,
          output: request.output,
        },
      });
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(channels.startJob, async (event, raw: unknown) => {
    const request = validated(jobCreateRequestSchema, raw);
    return isFailure(request)
      ? request
      : startAuthorizedJob(event.sender.id, request);
  });
  ipcMain.handle(channels.getJobs, (event) => scheduler.list(event.sender.id));
  ipcMain.handle(channels.getJobResult, (event, raw: unknown) => {
    const request = validated(
      z.object({ result: resultReferenceSchema }).strict(),
      raw,
    );
    return isFailure(request)
      ? request
      : scheduler.result(event.sender.id, request.result);
  });
  ipcMain.handle(channels.cancelJob, (event, raw: unknown) => {
    const request = validated(
      z.object({ job: taskReferenceSchema }).strict(),
      raw,
    );
    return isFailure(request)
      ? request
      : scheduler.cancel(event.sender.id, request.job);
  });
  scheduler.subscribe((jobEvent, owner) =>
    webContents.fromId(owner)?.send(channels.jobEvent, jobEvent),
  );

  ipcMain.handle(channels.saveReport, async (event, raw: unknown) => {
    const request = validated(saveReportRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const output = await registry.resolve(
        request.output,
        "report-output",
        event.sender.id,
        "saveReport",
      );
      const saved = await saveReportNoClobber(
        output,
        request.report as VerificationReport,
      );
      if (saved.ok)
        registry.consume(
          request.output,
          "report-output",
          event.sender.id,
          "saveReport",
        );
      return saved;
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.getState, async (event) => ({
    ok: true,
    data: await publicState(event.sender.id, stateStore.read()),
  }));
  ipcMain.handle(channels.setPreference, async (event, raw: unknown) => {
    const request = validated(setPreferenceRequestSchema, raw);
    return isFailure(request)
      ? request
      : {
          ok: true,
          data: await publicState(
            event.sender.id,
            stateStore.setPreference(request.key, request.value),
          ),
        };
  });
  ipcMain.handle(channels.rebuildRecents, async (event) =>
    legacy(event.sender.id, { operation: "rebuildRecents", input: {} }),
  );
  if (qaMode)
    ipcMain.handle(channels.qaCrashUtility, () => utility.crashForQa());

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const controller of creationAbortControllers.values()) {
      controller.abort();
    }
    await providerSupervisor.close();
    await scheduler.shutdown();
    await fs.rm(creationStagingRoot, { recursive: true, force: true });
    stateStore.close();
  };
  ipcMain.handle(channels.closeApp, async () => {
    await close();
    app.quit();
  });
  return { scheduler, stateStore, close };
}
