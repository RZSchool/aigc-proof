import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveWorkspaceTarget } from "./workspace-path";

let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "aigc-proof-workspace-path-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("workspace target resolution", () => {
  it("joins a valid Unicode folder name beneath an existing parent", async () => {
    const parent = path.join(root, "父目录 with space");
    await fs.mkdir(parent);

    const result = await resolveWorkspaceTarget({
      parent,
      folderName: "新 项目",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        parent: path.normalize(parent),
        folderName: "新 项目",
        path: path.join(parent, "新 项目"),
        exists: false,
      },
    });
  });

  it.each([
    "",
    ".",
    "..",
    "nested/name",
    "nested\\name",
    "NUL",
    "CON.txt",
    "trailing.",
    "trailing ",
    "bad?name",
    "x".repeat(121),
  ])("rejects the non-portable folder name %j", async (folderName) => {
    const result = await resolveWorkspaceTarget({ parent: root, folderName });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("WORKSPACE_FOLDER_NAME_INVALID");
  });

  it("reports an existing target without modifying it", async () => {
    const target = path.join(root, "existing");
    const marker = path.join(target, "user-file.txt");
    await fs.mkdir(target);
    await fs.writeFile(marker, "preserve me", "utf8");

    const result = await resolveWorkspaceTarget({
      parent: root,
      folderName: "existing",
    });

    expect(result.ok && result.data.exists).toBe(true);
    expect(await fs.readFile(marker, "utf8")).toBe("preserve me");
  });

  it("rejects a missing or relative parent directory", async () => {
    for (const parent of ["relative-parent", path.join(root, "missing")]) {
      const result = await resolveWorkspaceTarget({
        parent,
        folderName: "workspace",
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe("WORKSPACE_PARENT_INVALID");
    }
  });
});
