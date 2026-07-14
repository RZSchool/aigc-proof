import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadQaSelectionProvider } from "./qa-selections";

let root = "";

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("QA-only selection manifest", () => {
  it("is unavailable without the explicit QA flag", async () => {
    await expect(
      loadQaSelectionProvider(["--qa-selection-manifest=C:\\qa.json"], false),
    ).rejects.toThrow("QA_SELECTIONS_DISABLED");
  });

  it("provides deterministic native selections only in QA mode", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proof-qa-selection-"));
    const manifest = path.join(root, "selections.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        workspaceParents: [root],
        existingWorkspaces: [root],
        assets: [manifest],
        images: [manifest],
        imageOutputs: [path.join(root, "export.png")],
        packages: [manifest],
        packageOutputs: [path.join(root, "proof.aigcproof")],
        reportOutputs: [path.join(root, "report.json")],
      }),
      "utf8",
    );
    const provider = await loadQaSelectionProvider(
      [`--qa-selection-manifest=${manifest}`],
      true,
    );
    expect(provider?.take("workspaceParents")).toBe(root);
    expect(provider?.take("images")).toBe(manifest);
    expect(provider?.take("imageOutputs")).toBe(path.join(root, "export.png"));
    expect(() => provider?.take("workspaceParents")).toThrow(
      "QA_SELECTION_MISSING",
    );
  });
});
