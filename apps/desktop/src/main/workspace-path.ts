import fs from "node:fs/promises";
import path from "node:path";

import type { HostEnvelope } from "../shared/contracts";
import { workspaceFolderName } from "../shared/schemas";

function failure(
  code: string,
  message: string,
  selectedPath?: string,
): HostEnvelope<never> {
  return {
    ok: false,
    error: {
      code,
      kind: "input",
      message,
      ...(selectedPath ? { displayPath: selectedPath } : {}),
    },
  };
}

export async function resolveWorkspaceTarget(
  authorizedParent: string,
  folderName: string,
): Promise<HostEnvelope<{ displayPath: string; exists: boolean }>> {
  const parsed = workspaceFolderName.safeParse(folderName);
  if (!parsed.success) {
    return failure(
      "WORKSPACE_FOLDER_NAME_INVALID",
      parsed.error.issues[0]?.message ?? "新工作区文件夹名无效。",
    );
  }

  const parent = path.normalize(authorizedParent);
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

  const target = path.normalize(path.join(parent, parsed.data));
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
      displayPath: target,
      exists,
    },
  };
}
