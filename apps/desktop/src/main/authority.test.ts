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
    const workspace = await registry.issue("workspace", root);

    await expect(
      registry.resolve(
        { ...workspace, id: `ref_${"f".repeat(32)}` },
        "workspace",
      ),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_UNKNOWN" });
    await expect(registry.resolve(workspace, "asset")).rejects.toMatchObject({
      code: "HOST_REFERENCE_KIND_MISMATCH",
    });
    await expect(
      registry.resolve({ ...workspace, path: root }, "workspace"),
    ).rejects.toMatchObject({ code: "HOST_REFERENCE_INVALID" });

    now += 51;
    await expect(
      registry.resolve(workspace, "workspace"),
    ).rejects.toMatchObject({
      code: "HOST_REFERENCE_EXPIRED",
    });
  });

  it("treats display paths as non-authoritative and revalidates the selected path", async () => {
    const file = path.join(root, "input.txt");
    await fs.writeFile(file, "first", "utf8");
    const registry = new AuthorityRegistry();
    const reference = await registry.issue("asset", file);
    expect(
      await registry.resolve(
        { ...reference, displayPath: path.join(root, "forged.txt") },
        "asset",
      ),
    ).toBe(path.resolve(file));

    await fs.rm(file);
    await expect(registry.resolve(reference, "asset")).rejects.toBeInstanceOf(
      HostContractError,
    );
  });

  it("authorizes output names through their canonical existing parent", async () => {
    const output = path.join(root, "proof.aigcproof");
    const registry = new AuthorityRegistry();
    const reference = await registry.issue("package-output", output);
    expect(await registry.resolve(reference, "package-output")).toBe(
      path.resolve(output),
    );
  });
});
