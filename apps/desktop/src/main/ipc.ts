import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  HOST_CAPABILITIES,
  HOST_CONTRACT_VERSION,
  HostContractError,
  PROTOCOL_VERSION,
  UNAVAILABLE_FEATURES,
  WORKBENCH_VERSION,
  addAssetRequestSchema,
  addAssetResultSchema,
  hostDiagnosticsSchema,
  initializeWorkspaceRequestSchema,
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
import { app, dialog, ipcMain, webContents } from "electron";
import { z, type ZodType } from "zod";

import { channels } from "../shared/channels";
import type { UtilityJob } from "../shared/utility-protocol";
import { WorkbenchStateStore, type StoredWorkbenchState } from "./app-state";
import { AuthorityRegistry } from "./authority";
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

export interface RegisteredIpcRuntime {
  scheduler: JobScheduler;
  stateStore: WorkbenchStateStore;
  close(): Promise<void>;
}

function failure(error: unknown): HostEnvelope<never> {
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
  const diagnosticReference = Object.freeze({
    id: `ref_${randomUUID().replaceAll("-", "")}`,
    kind: "diagnostic",
    displayLabel: "Workbench 运行诊断",
  }) as DiagnosticReference;

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
                  ? ["loadWorkspace", "addAsset", "recordEvent", "sealPackage"]
                  : ["verifyPackage", "inspectPackage"],
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
        kind: "asset" | "package-output";
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
  ipcMain.handle(channels.choosePackage, async (event) => {
    const selected = await selectedOpenPath(qaSelections, "packages", {
      properties: ["openFile"],
      filters: [{ name: "AIGC-Proof", extensions: ["aigcproof"] }],
    });
    return selected
      ? registry.issue("package", selected, event.sender.id, [
          "verifyPackage",
          "inspectPackage",
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
  registerLegacy(channels.recordEvent, "recordEvent", recordEventRequestSchema);
  registerLegacy(channels.sealPackage, "sealPackage", sealPackageRequestSchema);
  registerLegacy(channels.verifyPackage, "verifyPackage", packageRequestSchema);
  registerLegacy(
    channels.inspectPackage,
    "inspectPackage",
    packageRequestSchema,
  );

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
    await scheduler.shutdown();
    stateStore.close();
  };
  ipcMain.handle(channels.closeApp, async () => {
    await close();
    app.quit();
  });
  return { scheduler, stateStore, close };
}
