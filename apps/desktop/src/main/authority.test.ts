import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { HostContractError } from "@aigc-proof/host-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthorityRegistry } from "./authority";

let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "proof-authority-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("Main authority registry", () => {
  it("rejects forged, unknown, expired, and mismatched-kind references", async () => {
    let now = 1_000;
    const registry = new AuthorityRegistry(() => now, 50);
    const workspace = await registry.issue("workspace", root, 7, [
      "loadWorkspace",
    ]);

    await expect(
      registry.resolve(
        { ...workspace, id: `ref_${"f".repeat(32)}` },
        "workspace",
        7,
        "loadWorkspace",
      ),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_UNKNOWN" });
    await expect(
      registry.resolve(workspace, "asset", 7, "loadWorkspace"),
    ).rejects.toMatchObject({
      code: "HOST_REFERENCE_KIND_MISMATCH",
    });
    await expect(
      registry.resolve(
        { ...workspace, path: root },
        "workspace",
        7,
        "loadWorkspace",
      ),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_INVALID" });

    now += 51;
    await expect(
      registry.resolve(workspace, "workspace", 7, "loadWorkspace"),
    ).rejects.toMatchObject({
      code: "HOST_REFERENCE_EXPIRED",
    });
  });

  it("rejects substituted display fields and revalidates the selected path", async () => {
    const file = path.join(root, "input.txt");
    await fs.writeFile(file, "first", "utf8");
    const registry = new AuthorityRegistry();
    const reference = await registry.issue("asset", file, 7, ["addAsset"]);
    await expect(
      registry.resolve(
        { ...reference, displayPath: path.join(root, "forged.txt") },
        "asset",
        7,
        "addAsset",
      ),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_INVALID" });

    expect(await registry.resolve(reference, "asset", 7, "addAsset")).toBe(
      path.resolve(file),
    );

    await fs.rm(file);
    await expect(
      registry.resolve(reference, "asset", 7, "addAsset"),
    ).rejects.toBeInstanceOf(HostContractError);
  });

  it("authorizes output names through their canonical existing parent", async () => {
    const output = path.join(root, "proof.aigcproof");
    const registry = new AuthorityRegistry();
    const reference = await registry.issue(
      "package-output",
      output,
      7,
      ["sealPackage"],
      undefined,
      undefined,
      true,
    );
    expect(
      await registry.resolve(reference, "package-output", 7, "sealPackage"),
    ).toBe(path.resolve(output));
    await expect(
      registry.resolve(reference, "package-output", 8, "sealPackage"),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_ORIGIN_MISMATCH" });
    registry.consume(reference, "package-output", 7, "sealPackage");
    await expect(
      registry.resolve(reference, "package-output", 7, "sealPackage"),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_REUSED" });
  });

  it("keeps image matching and image export operation-scoped and one-use", async () => {
    const imagePath = path.join(root, "生成 图片.png");
    await fs.writeFile(imagePath, "image", "utf8");
    const registry = new AuthorityRegistry();
    const image = await registry.issue(
      "image",
      imagePath,
      7,
      ["matchImageToPackage"],
      undefined,
      undefined,
      true,
    );
    const output = await registry.issue(
      "image-output",
      path.join(root, "保存 图片.png"),
      7,
      ["exportWorkspaceOutput"],
      undefined,
      undefined,
      true,
    );

    await expect(
      registry.resolve(image, "image", 7, "exportWorkspaceOutput"),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_PERMISSION_DENIED" });
    await expect(
      registry.resolve(output, "image-output", 7, "matchImageToPackage"),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_PERMISSION_DENIED" });
    expect(
      await registry.resolve(image, "image", 7, "matchImageToPackage", true),
    ).toBe(path.resolve(imagePath));
    await expect(
      registry.resolve(image, "image", 7, "matchImageToPackage"),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_REUSED" });
    registry.consume(output, "image-output", 7, "exportWorkspaceOutput");
    await expect(
      registry.resolve(output, "image-output", 7, "exportWorkspaceOutput"),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_REUSED" });
  });

  if (process.platform !== "win32") {
    it("rejects symbolic-link images before native dispatch", async () => {
      const target = path.join(root, "target.png");
      const link = path.join(root, "link.png");
      await fs.writeFile(target, "image", "utf8");
      await fs.symlink(target, link);
      const registry = new AuthorityRegistry();
      await expect(
        registry.issue("image", link, 7, ["matchImageToPackage"]),
      ).rejects.toMatchObject({ code: "HOST_REFERENCE_PATH_CHANGED" });
    });
  }
});
