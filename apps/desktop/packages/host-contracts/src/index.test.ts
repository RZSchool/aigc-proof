import { describe, expect, it } from "vitest";

import {
  HOST_CONTRACT_VERSION,
  HOST_CAPABILITIES,
  HostContractError,
  NATIVE_API_VERSION,
  NATIVE_CAPABILITIES,
  NATIVE_ENGINE_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_LIMITS,
  hostReferenceSchema,
  hostDiagnosticsSchema,
  initializeWorkspaceRequestSchema,
  isCompatibleSemVer,
  proofHostResponseSchemas,
  validateNativeDiscovery,
  workspaceSummarySchema,
} from "./index";

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: NATIVE_API_VERSION,
    engineVersion: NATIVE_ENGINE_VERSION,
    supportedProtocolVersions: [PROTOCOL_VERSION],
    capabilities: [...NATIVE_CAPABILITIES].sort(),
    execution: {
      napiAsyncTasks: true,
      utilityProcessIsolation: true,
      progressStreaming: true,
      safeCancellation: false,
    },
    limits: RUNTIME_LIMITS,
    ...overrides,
  };
}

describe("@aigc-proof/host-contracts", () => {
  it("loads as a renderer-safe package with independent version identities", () => {
    expect(HOST_CONTRACT_VERSION).toBe("1.1.0");
    expect(NATIVE_API_VERSION).toBe("1.1.0");
    expect(NATIVE_ENGINE_VERSION).toBe("0.2.0");
    expect(PROTOCOL_VERSION).toBe("0.2.0");
  });

  it("applies fail-closed SemVer and capability compatibility", () => {
    expect(isCompatibleSemVer("1.0.0", "1.9.2")).toBe(true);
    expect(isCompatibleSemVer("1.1.0", "1.0.9")).toBe(false);
    expect(isCompatibleSemVer("1.0.0", "2.0.0")).toBe(false);
    expect(isCompatibleSemVer("1.0.0", "not-semver")).toBe(false);
    expect(validateNativeDiscovery(discovery()).apiVersion).toBe("1.1.0");
    for (const invalid of [
      discovery({ apiVersion: "2.0.0" }),
      discovery({ engineVersion: "0.3.0" }),
      discovery({ supportedProtocolVersions: ["0.1.0"] }),
      discovery({ capabilities: NATIVE_CAPABILITIES.slice(1) }),
      discovery({
        execution: { ...discovery().execution, utilityProcessIsolation: false },
      }),
      discovery({ limits: { ...RUNTIME_LIMITS, maxQueuedJobs: 17 } }),
      null,
    ]) {
      expect(() => validateNativeDiscovery(invalid)).toThrow(HostContractError);
    }
  });

  it("validates opaque references and rejects path authority or unknown fields", () => {
    const parent = {
      id: `ref_${"a".repeat(32)}`,
      kind: "workspace-parent" as const,
      displayLabel: "Workspace parent",
      displayPath: "C:\\display only",
    };
    expect(hostReferenceSchema.parse(parent)).toEqual(parent);
    expect(
      initializeWorkspaceRequestSchema.parse({
        parent,
        folderName: "项目 test",
      }),
    ).toBeTruthy();
    expect(() =>
      initializeWorkspaceRequestSchema.parse({
        parent: { ...parent, path: "C:\\forged" },
        folderName: "project",
      }),
    ).toThrow();
    expect(() =>
      hostReferenceSchema.parse({ ...parent, kind: "admin" }),
    ).toThrow();
  });

  it("rejects malformed, missing, duplicate, and unsorted 1.1 capabilities", () => {
    const cases = [
      {},
      discovery({ apiVersion: undefined }),
      discovery({
        capabilities: [NATIVE_CAPABILITIES[0], NATIVE_CAPABILITIES[0]],
      }),
      discovery({ capabilities: [...NATIVE_CAPABILITIES].reverse() }),
      discovery({ extra: true }),
    ];
    for (const value of cases) {
      expect(() => validateNativeDiscovery(value)).toThrow(HostContractError);
    }
  });

  it("strictly validates response DTOs and diagnostics", () => {
    const workspace = {
      reference: {
        id: `ref_${"d".repeat(32)}`,
        kind: "workspace",
        displayLabel: "workspace",
        displayPath: "C:\\workspace",
      },
      displayPath: "C:\\workspace",
      workspace: {
        workspace_version: "0.2.0",
        created_at: "2026-07-13T00:00:00Z",
        project: {},
        assets: [],
      },
    };
    expect(workspaceSummarySchema.parse(workspace)).toEqual(workspace);
    expect(() =>
      workspaceSummarySchema.parse({ ...workspace, path: "C:\\authority" }),
    ).toThrow();

    const diagnostics = {
      reference: {
        id: `ref_${"e".repeat(32)}`,
        kind: "diagnostic",
        displayLabel: "diagnostics",
      },
      hostKind: "standalone",
      workbenchVersion: "0.3.0",
      contractVersion: "1.1.0",
      nativeApiVersion: "1.1.0",
      engineVersion: "0.2.0",
      protocolVersion: "0.2.0",
      supportedProtocolVersions: ["0.2.0"],
      capabilities: [...HOST_CAPABILITIES],
      execution: discovery().execution,
      limits: RUNTIME_LIMITS,
      utility: { state: "healthy", generation: 1, processId: 4242 },
      unavailableFeatures: ["integration.aigcstudio"],
    };
    expect(hostDiagnosticsSchema.parse(diagnostics)).toEqual(diagnostics);
    expect(() =>
      hostDiagnosticsSchema.parse({ ...diagnostics, certified: true }),
    ).toThrow();
  });

  it("strictly validates every ProofHostApi response shape", () => {
    const reference = (kind: string, marker: string) => ({
      id: `ref_${marker.repeat(32)}`,
      kind,
      displayLabel: kind,
      displayPath: `C:\\${kind}`,
    });
    const references = {
      parent: reference("workspace-parent", "a"),
      workspace: reference("workspace", "b"),
      asset: reference("asset", "c"),
      package: reference("package", "d"),
      packageOutput: reference("package-output", "e"),
      reportOutput: reference("report-output", "f"),
      task: reference("task", "g"),
      result: reference("result", "h"),
      diagnostic: reference("diagnostic", "i"),
    };
    const asset = {
      asset_id: "asset-1",
      role: "input",
      package_path: "assets/input/asset-1.txt",
      original_name: "asset-1.txt",
      media_type: "text/plain",
      size_bytes: 1,
      sha256: "0".repeat(64),
    };
    const workspace = {
      workspace_version: "0.2.0",
      created_at: "2026-07-13T00:00:00Z",
      project: {},
      assets: [asset],
    };
    const summary = {
      reference: references.workspace,
      displayPath: "C:\\workspace",
      workspace,
    };
    const event = {
      event_id: "event-1",
      sequence: 1,
      event_type: "generation",
      created_at: "2026-07-13T00:00:00Z",
      previous_event_hash: null,
      payload: {},
      event_hash: "1".repeat(64),
    };
    const report = {
      spec_version: "0.2.0",
      proof_id: "urn:uuid:test",
      verified_at: "2026-07-13T00:00:00Z",
      status: "valid",
      assurance: {
        internal_integrity: "valid",
        creator_identity: "not_verified",
        digital_signature: "not_present",
        trusted_time: "not_present",
        originality: "not_evaluated",
      },
      checks: [],
      errors: [],
      warnings: [],
    };
    const inspection = {
      spec_version: "0.2.0",
      proof_id: "urn:uuid:test",
      created_at: "2026-07-13T00:00:00Z",
      project: {},
      assets: [asset],
      event_chain: {
        algorithm: "sha-256",
        event_count: 1,
        root_hash: "1".repeat(64),
      },
      assurance_level: "Internal Integrity",
      verification_performed: false,
    };
    const state = {
      schemaVersion: 1,
      preferences: {},
      recentWorkspaces: [
        {
          reference: references.workspace,
          displayPath: "C:\\workspace",
          lastOpenedAt: "2026-07-13T00:00:00Z",
        },
      ],
      recentPackages: [
        {
          reference: references.package,
          displayPath: "C:\\proof.aigcproof",
          lastOpenedAt: "2026-07-13T00:00:00Z",
        },
      ],
    };
    const diagnostics = {
      reference: references.diagnostic,
      hostKind: "standalone",
      workbenchVersion: "0.3.0",
      contractVersion: "1.1.0",
      nativeApiVersion: "1.1.0",
      engineVersion: "0.2.0",
      protocolVersion: "0.2.0",
      supportedProtocolVersions: ["0.2.0"],
      capabilities: [...HOST_CAPABILITIES],
      execution: discovery().execution,
      limits: RUNTIME_LIMITS,
      utility: { state: "healthy", generation: 1, processId: 4242 },
      unavailableFeatures: ["integration.aigcstudio"],
    };
    const job = {
      reference: references.task,
      operation: "verifyPackage",
      state: "succeeded",
      progress: {
        sequence: 4,
        phase: "complete",
        completedUnits: 100,
        totalUnits: 100,
        message: "complete",
        interruptibility: "atomic",
        observedAt: "2026-07-13T00:00:01Z",
      },
      createdAt: "2026-07-13T00:00:00Z",
      startedAt: "2026-07-13T00:00:00Z",
      finishedAt: "2026-07-13T00:00:01Z",
      result: references.result,
    };
    const valid: Record<string, unknown> = {
      getDiagnostics: { ok: true, data: diagnostics },
      chooseWorkspaceParent: references.parent,
      chooseExistingWorkspace: references.workspace,
      chooseAsset: references.asset,
      choosePackage: references.package,
      choosePackageOutput: references.packageOutput,
      chooseReportOutput: references.reportOutput,
      previewWorkspaceTarget: {
        ok: true,
        data: {
          parent: references.parent,
          folderName: "project",
          displayPath: "C:\\project",
          exists: false,
        },
      },
      initializeWorkspace: { ok: true, data: summary },
      loadWorkspace: { ok: true, data: summary },
      addAsset: { ok: true, data: { asset, workspace } },
      recordEvent: { ok: true, data: { event } },
      sealPackage: {
        ok: true,
        data: {
          package: references.package,
          displayPath: "C:\\proof.aigcproof",
          manifest: { spec_version: "0.2.0" },
        },
      },
      verifyPackage: { ok: true, data: report },
      inspectPackage: { ok: true, data: inspection },
      saveReport: {
        ok: true,
        data: { displayPath: "C:\\report.json" },
      },
      getState: { ok: true, data: state },
      setPreference: { ok: true, data: state },
      rebuildRecents: { ok: true, data: state },
      startJob: { ok: true, data: job },
      getJobs: { ok: true, data: [job] },
      getJobResult: {
        ok: true,
        data: { operation: "verifyPackage", data: report },
      },
      cancelJob: { ok: true, data: job },
      closeApp: undefined,
    };

    expect(Object.keys(valid).sort()).toEqual(
      Object.keys(proofHostResponseSchemas).sort(),
    );
    for (const [name, schema] of Object.entries(proofHostResponseSchemas)) {
      expect(() => schema.parse(valid[name])).not.toThrow();
      if (valid[name] && typeof valid[name] === "object") {
        expect(() =>
          schema.parse({ ...valid[name], unexpected: true }),
        ).toThrow();
      }
    }
    expect(() =>
      proofHostResponseSchemas.chooseAsset.parse(references.workspace),
    ).toThrow();
    expect(() =>
      proofHostResponseSchemas.getState.parse({
        ok: false,
        error: { code: "STATE_FAILED", kind: "io", message: "failed" },
      }),
    ).not.toThrow();
  });
});
