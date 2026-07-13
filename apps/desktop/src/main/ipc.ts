import fs from "node:fs/promises";
import path from "node:path";

import {
  HOST_CONTRACT_VERSION,
  HostContractError,
  PROTOCOL_VERSION,
  UNAVAILABLE_FEATURES,
  WORKBENCH_VERSION,
  type HostDiagnostics,
  type HostEnvelope,
  type Inspection,
  type VerificationReport,
  type WorkbenchState,
  type Workspace,
  type WorkspaceParentReference,
  type WorkspaceSummary,
  addAssetRequestSchema,
  hostDiagnosticsSchema,
  initializeWorkspaceRequestSchema,
  packageRequestSchema,
  recordEventRequestSchema,
  saveReportRequestSchema,
  sealPackageRequestSchema,
  setPreferenceRequestSchema,
  workspaceRequestSchema,
  workspaceTargetRequestSchema,
} from "@aigc-proof/host-contracts";
import { app, dialog, ipcMain } from "electron";
import type { ZodType } from "zod";

import { channels } from "../shared/channels";
import { AuthorityRegistry } from "./authority";
import { invokeNative, type NativeRuntime } from "./native";
import type { QaSelectionKind, QaSelectionProvider } from "./qa-selections";
import { resolveWorkspaceTarget } from "./workspace-path";

interface NativeWorkspaceSummary {
  path: string;
  workspace: Workspace;
}

interface NativeRecentItem {
  path: string;
  lastOpenedAt: string;
}

interface NativeWorkbenchState {
  schemaVersion: number;
  preferences: Record<string, string>;
  recentWorkspaces: NativeRecentItem[];
  recentPackages: NativeRecentItem[];
}

let databasePath = "";

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

async function remember(
  runtime: NativeRuntime,
  kind: "workspace" | "package",
  selectedPath: string,
): Promise<void> {
  await invokeNative<NativeWorkbenchState>(
    runtime.addon.rememberRecentItem({
      database: databasePath,
      kind,
      path: selectedPath,
    }),
  );
}

async function publicState(
  registry: AuthorityRegistry,
  state: NativeWorkbenchState,
): Promise<WorkbenchState> {
  const issueRecent = async <K extends "workspace" | "package">(
    kind: K,
    items: NativeRecentItem[],
  ) => {
    const converted = await Promise.all(
      items.map(async (item) => {
        try {
          return {
            reference: await registry.issue(kind, item.path),
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

async function workspaceSummary(
  registry: AuthorityRegistry,
  native: NativeWorkspaceSummary,
): Promise<WorkspaceSummary> {
  return {
    reference: await registry.issue("workspace", native.path),
    displayPath: native.path,
    workspace: native.workspace,
  };
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

export async function registerIpc(
  runtime: NativeRuntime,
  qaSelections?: QaSelectionProvider,
): Promise<HostEnvelope<WorkbenchState>> {
  const registry = new AuthorityRegistry();
  const { addon, discovery } = runtime;
  databasePath = path.join(app.getPath("userData"), "workbench.sqlite3");
  const initialNativeState = await invokeNative<NativeWorkbenchState>(
    addon.initializeAppState({ database: databasePath }),
  );
  if (!initialNativeState.ok) return initialNativeState;

  const diagnostics: HostDiagnostics = hostDiagnosticsSchema.parse({
    hostKind: "standalone",
    workbenchVersion: WORKBENCH_VERSION,
    contractVersion: HOST_CONTRACT_VERSION,
    nativeApiVersion: discovery.apiVersion,
    engineVersion: discovery.engineVersion,
    protocolVersion: PROTOCOL_VERSION,
    supportedProtocolVersions: discovery.supportedProtocolVersions,
    capabilities: discovery.capabilities,
    execution: discovery.execution,
    unavailableFeatures: [...UNAVAILABLE_FEATURES],
  });

  ipcMain.handle(channels.getDiagnostics, () => ({
    ok: true,
    data: diagnostics,
  }));
  ipcMain.handle(channels.chooseWorkspaceParent, async () => {
    const selected = await selectedOpenPath(qaSelections, "workspaceParents", {
      title: "选择新工作区的父文件夹",
      buttonLabel: "选择父文件夹",
      properties: ["openDirectory"],
    });
    return selected ? registry.issue("workspace-parent", selected) : null;
  });
  ipcMain.handle(channels.chooseExistingWorkspace, async () => {
    const selected = await selectedOpenPath(
      qaSelections,
      "existingWorkspaces",
      {
        title: "选择已有 AIGC-Proof 工作区",
        buttonLabel: "打开工作区",
        properties: ["openDirectory"],
      },
    );
    return selected ? registry.issue("workspace", selected) : null;
  });
  ipcMain.handle(channels.chooseAsset, async () => {
    const selected = await selectedOpenPath(qaSelections, "assets", {
      properties: ["openFile"],
    });
    return selected ? registry.issue("asset", selected) : null;
  });
  ipcMain.handle(channels.choosePackage, async () => {
    const selected = await selectedOpenPath(qaSelections, "packages", {
      properties: ["openFile"],
      filters: [{ name: "AIGC-Proof", extensions: ["aigcproof"] }],
    });
    return selected ? registry.issue("package", selected) : null;
  });
  ipcMain.handle(channels.choosePackageOutput, async () => {
    const selected = await selectedSavePath(qaSelections, "packageOutputs", {
      filters: [{ name: "AIGC-Proof", extensions: ["aigcproof"] }],
    });
    return selected ? registry.issue("package-output", selected) : null;
  });
  ipcMain.handle(channels.chooseReportOutput, async () => {
    const selected = await selectedSavePath(qaSelections, "reportOutputs", {
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return selected ? registry.issue("report-output", selected) : null;
  });

  ipcMain.handle(
    channels.previewWorkspaceTarget,
    async (_event, raw: unknown) => {
      const request = validated(workspaceTargetRequestSchema, raw);
      if (isFailure(request)) return request;
      try {
        const parentPath = await registry.resolve(
          request.parent,
          "workspace-parent",
        );
        const target = await resolveWorkspaceTarget(
          parentPath,
          request.folderName,
        );
        if (!target.ok) return target;
        return {
          ok: true,
          data: {
            parent: request.parent as WorkspaceParentReference,
            folderName: request.folderName,
            displayPath: target.data.displayPath,
            exists: target.data.exists,
          },
        } satisfies HostEnvelope<unknown>;
      } catch (error) {
        return failure(error);
      }
    },
  );
  ipcMain.handle(channels.initializeWorkspace, async (_event, raw: unknown) => {
    const request = validated(initializeWorkspaceRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const parentPath = await registry.resolve(
        request.parent,
        "workspace-parent",
      );
      const preview = await resolveWorkspaceTarget(
        parentPath,
        request.folderName,
      );
      if (!preview.ok) return preview;
      if (preview.data.exists) {
        return {
          ok: false,
          error: {
            code: "WORKSPACE_ALREADY_EXISTS",
            kind: "output_already_exists",
            message:
              "目标已存在。若它是有效的 AIGC-Proof 工作区，请使用“打开已有工作区”；否则请选择其他文件夹名。",
            displayPath: preview.data.displayPath,
          },
        } satisfies HostEnvelope<never>;
      }
      const nativeRequest = {
        path: preview.data.displayPath,
        ...(request.projectName ? { projectName: request.projectName } : {}),
      };
      const result = await invokeNative<NativeWorkspaceSummary>(
        addon.initializeWorkspace(nativeRequest),
      );
      if (!result.ok) return result;
      await remember(runtime, "workspace", result.data.path);
      return {
        ok: true,
        data: await workspaceSummary(registry, result.data),
      };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.loadWorkspace, async (_event, raw: unknown) => {
    const request = validated(workspaceRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const selected = await registry.resolve(request.workspace, "workspace");
      const result = await invokeNative<NativeWorkspaceSummary>(
        addon.loadWorkspaceSummary({ path: selected }),
      );
      if (!result.ok) return result;
      await remember(runtime, "workspace", selected);
      return { ok: true, data: await workspaceSummary(registry, result.data) };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.addAsset, async (_event, raw: unknown) => {
    const request = validated(addAssetRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const workspace = await registry.resolve(request.workspace, "workspace");
      const source = await registry.resolve(request.source, "asset");
      return invokeNative(
        addon.addWorkspaceAsset({ workspace, source, role: request.role }),
      );
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.recordEvent, async (_event, raw: unknown) => {
    const request = validated(recordEventRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const workspace = await registry.resolve(request.workspace, "workspace");
      return invokeNative(
        addon.recordWorkspaceEvent({
          workspace,
          eventType: request.eventType,
          payloadJson: request.payloadJson,
        }),
      );
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.sealPackage, async (_event, raw: unknown) => {
    const request = validated(sealPackageRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const workspace = await registry.resolve(request.workspace, "workspace");
      const output = await registry.resolve(request.output, "package-output");
      const result = await invokeNative<{
        path: string;
        manifest: Record<string, unknown>;
      }>(addon.sealProofPackage({ workspace, output }));
      if (!result.ok) return result;
      await remember(runtime, "package", result.data.path);
      return {
        ok: true,
        data: {
          package: await registry.issue("package", result.data.path),
          displayPath: result.data.path,
          manifest: result.data.manifest,
        },
      };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.verifyPackage, async (_event, raw: unknown) => {
    const request = validated(packageRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const selected = await registry.resolve(request.package, "package");
      const result = await invokeNative<VerificationReport>(
        addon.verifyProofPackage({ path: selected }),
      );
      if (result.ok) await remember(runtime, "package", selected);
      return result;
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.inspectPackage, async (_event, raw: unknown) => {
    const request = validated(packageRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const selected = await registry.resolve(request.package, "package");
      const result = await invokeNative<Inspection>(
        addon.inspectProofPackage({ path: selected }),
      );
      if (result.ok) await remember(runtime, "package", selected);
      return result;
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.saveReport, async (_event, raw: unknown) => {
    const request = validated(saveReportRequestSchema, raw);
    if (isFailure(request)) return request;
    try {
      const output = await registry.resolve(request.output, "report-output");
      return saveReportNoClobber(output, request.report as VerificationReport);
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle(channels.getState, async () => {
    const result = await invokeNative<NativeWorkbenchState>(
      addon.getAppState({ database: databasePath }),
    );
    return result.ok
      ? { ok: true, data: await publicState(registry, result.data) }
      : result;
  });
  ipcMain.handle(channels.setPreference, async (_event, raw: unknown) => {
    const request = validated(setPreferenceRequestSchema, raw);
    if (isFailure(request)) return request;
    const result = await invokeNative<NativeWorkbenchState>(
      addon.setAppPreference({ database: databasePath, ...request }),
    );
    return result.ok
      ? { ok: true, data: await publicState(registry, result.data) }
      : result;
  });
  ipcMain.handle(channels.rebuildRecents, async () => {
    const result = await invokeNative<NativeWorkbenchState>(
      addon.rebuildRecentIndexes({ database: databasePath }),
    );
    return result.ok
      ? { ok: true, data: await publicState(registry, result.data) }
      : result;
  });
  ipcMain.handle(channels.closeApp, () => app.quit());
  return {
    ok: true,
    data: await publicState(registry, initialNativeState.data),
  };
}
