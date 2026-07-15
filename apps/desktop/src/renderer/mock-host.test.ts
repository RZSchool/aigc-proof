import {
  HOST_CONTRACT_VERSION,
  hostReferenceSchema,
} from "@aigc-proof/host-contracts";
import { describe, expect, it } from "vitest";

import { DeterministicMockProofHost } from "./mock-host";

describe("deterministic ProofHostApi mock", () => {
  it("implements the same contract without Electron or native loading", async () => {
    const host = new DeterministicMockProofHost();
    expect(
      hostReferenceSchema.parse(await host.chooseWorkspaceParent()).kind,
    ).toBe("workspace-parent");
    const diagnostics = await host.getDiagnostics();
    expect(diagnostics.ok && diagnostics.data.contractVersion).toBe(
      HOST_CONTRACT_VERSION,
    );
    expect(
      diagnostics.ok && diagnostics.data.execution.utilityProcessIsolation,
    ).toBe(true);
    const created = await host.initializeWorkspace({
      parent: host.workspaceParent,
      folderName: "mock-project",
    });
    expect(created.ok && created.data.workspace.workspace_version).toBe(
      "0.3.0",
    );
    const job = await host.startJob({
      operation: "loadWorkspace",
      input: { workspace: host.workspaceReference },
    });
    expect(job.ok && job.data.state).toBe("succeeded");
    const jobs = await host.getJobs();
    expect(jobs.ok && jobs.data).toHaveLength(1);
  });
});
