import fs from "node:fs/promises";
import path from "node:path";

import type {
  BridgeEnvelope,
  WorkspaceTargetPreview,
} from "../shared/contracts";
import { workspaceTargetRequest } from "../shared/schemas";

function failure(
  code: string,
  message: string,
  selectedPath?: string,
): BridgeEnvelope<never> {
  return {
    ok: false,
    error: {
      code,
      kind: "input",
      message,
      ...(selectedPath ? { path: selectedPath } : {}),
    },
  };
}

export async function resolveWorkspaceTarget(
  raw: unknown,
): Promise<BridgeEnvelope<WorkspaceTargetPreview>> {
  const parsed = workspaceTargetRequest.safeParse(raw);
  if (!parsed.success) {
    return failure(
      "WORKSPACE_FOLDER_NAME_INVALID",
      parsed.error.issues[0]?.message ?? "新工作区文件夹名无效。",
    );
  }

  const parent = path.normalize(parsed.data.parent);
  if (!path.isAbsolute(parent)) {
    return failure(
      "WORKSPACE_PARENT_INVALID",
      "请选择一个已存在的绝对父目录。",
      parent,
    );
  }
  try {
    const metadata = await fs.stat(parent);
    if (!metadata.isDirectory()) {
      return failure(
        "WORKSPACE_PARENT_INVALID",
        "所选父路径不是文件夹。",
        parent,
      );
    }
  } catch {
    return failure(
      "WORKSPACE_PARENT_INVALID",
      "所选父文件夹不存在或无法访问。",
      parent,
    );
  }

  const target = path.normalize(path.join(parent, parsed.data.folderName));
  if (path.dirname(target) !== parent) {
    return failure(
      "WORKSPACE_FOLDER_NAME_INVALID",
      "新工作区文件夹名必须是单个可移植路径组件。",
    );
  }

  let exists = false;
  try {
    await fs.lstat(target);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return failure(
        "WORKSPACE_TARGET_CHECK_FAILED",
        "无法确认新工作区目标是否存在。",
        target,
      );
    }
  }

  return {
    ok: true,
    data: {
      parent,
      folderName: parsed.data.folderName,
      path: target,
      exists,
    },
  };
}
