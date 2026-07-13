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
});
