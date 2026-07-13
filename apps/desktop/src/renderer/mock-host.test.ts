import { hostReferenceSchema } from "@aigc-proof/host-contracts";
import { describe, expect, it } from "vitest";

import { DeterministicMockProofHost } from "./mock-host";

describe("deterministic ProofHostApi mock", () => {
  it("implements the same contract without Electron or native loading", async () => {
    const host = new DeterministicMockProofHost();
    expect(
      hostReferenceSchema.parse(await host.chooseWorkspaceParent()).kind,
    ).toBe("workspace-parent");
    const diagnostics = await host.getDiagnostics();
    expect(diagnostics.ok && diagnostics.data.contractVersion).toBe("1.0.0");
    expect(
      diagnostics.ok && diagnostics.data.execution.utilityProcessIsolation,
    ).toBe(false);
    const created = await host.initializeWorkspace({
      parent: host.workspaceParent,
      folderName: "mock-project",
    });
    expect(created.ok && created.data.workspace.workspace_version).toBe(
      "0.2.0",
    );
  });
});
