import fs from "node:fs/promises";
import path from "node:path";

import { app, dialog, ipcMain } from "electron";
import type { ZodType } from "zod";

import type {
  BridgeEnvelope,
  Inspection,
  VerificationReport,
  WorkbenchState,
  WorkspaceSummary,
} from "../shared/contracts";
import { channels } from "../shared/channels";
import {
  addAssetRequest,
  initializeWorkspaceRequest,
  pathRequest,
  recordEventRequest,
  saveReportRequest,
  sealPackageRequest,
  setPreferenceRequest,
} from "../shared/schemas";
import { invokeNative, loadNativeAddon } from "./native";
import { resolveWorkspaceTarget } from "./workspace-path";

let databasePath = "";

function inputFailure(error: unknown): BridgeEnvelope<never> {
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
): T | BridgeEnvelope<never> {
  try {
    return schema.parse(value);
  } catch (error) {
    return inputFailure(error);
  }
}

function isFailure(value: unknown): value is BridgeEnvelope<never> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false
  );
}

async function remember(
  kind: "workspace" | "package",
  selectedPath: string,
): Promise<void> {
  await invokeNative<WorkbenchState>(
    loadNativeAddon().rememberRecentItem({
      database: databasePath,
      kind,
      path: selectedPath,
    }),
  );
}

async function saveReportNoClobber(
  selectedPath: string,
  report: VerificationReport,
): Promise<BridgeEnvelope<{ path: string }>> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(selectedPath, "wx");
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    return { ok: true, data: { path: selectedPath } };
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
        path: selectedPath,
      },
    };
  }
}

export async function registerIpc(): Promise<BridgeEnvelope<WorkbenchState>> {
  databasePath = path.join(app.getPath("userData"), "workbench.sqlite3");
  const addon = loadNativeAddon();
  const initialState = await invokeNative<WorkbenchState>(
    addon.initializeAppState({ database: databasePath }),
  );

  ipcMain.handle(channels.chooseWorkspaceParent, async () => {
    const result = await dialog.showOpenDialog({
      title: "选择新工作区的父文件夹",
      buttonLabel: "选择父文件夹",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(channels.chooseExistingWorkspace, async () => {
    const result = await dialog.showOpenDialog({
      title: "选择已有 AIGC-Proof 工作区",
      buttonLabel: "打开工作区",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(channels.chooseAsset, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(channels.choosePackage, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "AIGC-Proof", extensions: ["aigcproof"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(channels.choosePackageOutput, async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: "AIGC-Proof", extensions: ["aigcproof"] }],
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle(channels.chooseReportOutput, async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle(
    channels.previewWorkspaceTarget,
    async (_event, raw: unknown) => resolveWorkspaceTarget(raw),
  );
  ipcMain.handle(channels.initializeWorkspace, async (_event, raw: unknown) => {
    const request = validated(initializeWorkspaceRequest, raw);
    if (isFailure(request)) return request;
    const preview = await resolveWorkspaceTarget({
      parent: request.parent,
      folderName: request.folderName,
    });
    if (!preview.ok) return preview;
    if (preview.data.exists) {
      return {
        ok: false,
        error: {
          code: "WORKSPACE_ALREADY_EXISTS",
          kind: "output_already_exists",
          message:
            "目标已存在。若它是有效的 AIGC-Proof 工作区，请使用“打开已有工作区”；否则请选择其他文件夹名。",
          path: preview.data.path,
        },
      } satisfies BridgeEnvelope<never>;
    }
    const nativeRequest = {
      path: preview.data.path,
      ...(request.projectName ? { projectName: request.projectName } : {}),
    };
    const result = await invokeNative<WorkspaceSummary>(
      addon.initializeWorkspace(nativeRequest),
    );
    if (result.ok) await remember("workspace", preview.data.path);
    return result;
  });
  ipcMain.handle(channels.loadWorkspace, async (_event, raw: unknown) => {
    const request = validated(pathRequest, raw);
    if (isFailure(request)) return request;
    const result = await invokeNative<WorkspaceSummary>(
      addon.loadWorkspaceSummary(request),
    );
    if (result.ok) await remember("workspace", request.path);
    return result;
  });
  ipcMain.handle(channels.addAsset, async (_event, raw: unknown) => {
    const request = validated(addAssetRequest, raw);
    if (isFailure(request)) return request;
    return invokeNative(addon.addWorkspaceAsset(request));
  });
  ipcMain.handle(channels.recordEvent, async (_event, raw: unknown) => {
    const request = validated(recordEventRequest, raw);
    if (isFailure(request)) return request;
    return invokeNative(addon.recordWorkspaceEvent(request));
  });
  ipcMain.handle(channels.sealPackage, async (_event, raw: unknown) => {
    const request = validated(sealPackageRequest, raw);
    if (isFailure(request)) return request;
    const result = await invokeNative<{ path: string }>(
      addon.sealProofPackage(request),
    );
    if (result.ok) await remember("package", request.output);
    return result;
  });
  ipcMain.handle(channels.verifyPackage, async (_event, raw: unknown) => {
    const request = validated(pathRequest, raw);
    if (isFailure(request)) return request;
    const result = await invokeNative<VerificationReport>(
      addon.verifyProofPackage(request),
    );
    if (result.ok) await remember("package", request.path);
    return result;
  });
  ipcMain.handle(channels.inspectPackage, async (_event, raw: unknown) => {
    const request = validated(pathRequest, raw);
    if (isFailure(request)) return request;
    const result = await invokeNative<Inspection>(
      addon.inspectProofPackage(request),
    );
    if (result.ok) await remember("package", request.path);
    return result;
  });
  ipcMain.handle(channels.saveReport, async (_event, raw: unknown) => {
    const request = validated(saveReportRequest, raw);
    if (isFailure(request)) return request;
    return saveReportNoClobber(
      request.path,
      request.report as VerificationReport,
    );
  });
  ipcMain.handle(channels.getState, () =>
    invokeNative<WorkbenchState>(addon.getAppState({ database: databasePath })),
  );
  ipcMain.handle(channels.setPreference, async (_event, raw: unknown) => {
    const request = validated(setPreferenceRequest, raw);
    if (isFailure(request)) return request;
    return invokeNative<WorkbenchState>(
      addon.setAppPreference({ database: databasePath, ...request }),
    );
  });
  ipcMain.handle(channels.rebuildRecents, () =>
    invokeNative<WorkbenchState>(
      addon.rebuildRecentIndexes({ database: databasePath }),
    ),
  );
  ipcMain.handle(channels.closeApp, () => app.quit());
  return initialState;
}
