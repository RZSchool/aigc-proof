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
  WORKBENCH_VERSION,
  getCreationSessionsRequestSchema,
  hostReferenceSchema,
  hostDiagnosticsSchema,
  initializeWorkspaceRequestSchema,
  isCompatibleSemVer,
  proofHostResponseSchemas,
  signerLabelSchema,
  validateNativeDiscovery,
  workspaceSummarySchema,
} from "./index";

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: NATIVE_API_VERSION,
    engineVersion: NATIVE_ENGINE_VERSION,
    supportedProtocolVersions: ["0.2.0", PROTOCOL_VERSION],
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
    expect(WORKBENCH_VERSION).toBe("0.7.0");
    expect(HOST_CONTRACT_VERSION).toBe("1.6.0");
    expect(NATIVE_API_VERSION).toBe("1.5.0");
    expect(NATIVE_ENGINE_VERSION).toBe("0.4.0");
    expect(PROTOCOL_VERSION).toBe("0.4.0");
  });

  it("applies fail-closed SemVer and capability compatibility", () => {
    expect(isCompatibleSemVer("1.0.0", "1.9.2")).toBe(true);
    expect(isCompatibleSemVer("1.1.0", "1.0.9")).toBe(false);
    expect(isCompatibleSemVer("1.0.0", "2.0.0")).toBe(false);
    expect(isCompatibleSemVer("1.0.0", "not-semver")).toBe(false);
    expect(validateNativeDiscovery(discovery()).apiVersion).toBe("1.5.0");
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
    const workspace = { ...parent, kind: "workspace" as const };
    expect(getCreationSessionsRequestSchema.parse({ workspace })).toEqual({
      workspace,
    });
    expect(() => getCreationSessionsRequestSchema.parse({})).toThrow();
    expect(() =>
      getCreationSessionsRequestSchema.parse({ workspace, path: "C:\\forged" }),
    ).toThrow();
  });

  it("enforces the creator label canonical and UTF-8 byte boundaries", () => {
    expect(signerLabelSchema.parse("创建者".repeat(22))).toHaveLength(66);
    expect(() => signerLabelSchema.parse("创建者".repeat(23))).toThrow();
    expect(() => signerLabelSchema.parse("e\u0301")).toThrow();
    expect(() => signerLabelSchema.parse("creator\u202eexe")).toThrow();
  });

  it("rejects malformed, missing, duplicate, and unsorted 1.3 capabilities", () => {
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
      workbenchVersion: WORKBENCH_VERSION,
      contractVersion: HOST_CONTRACT_VERSION,
      nativeApiVersion: NATIVE_API_VERSION,
      engineVersion: NATIVE_ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      supportedProtocolVersions: ["0.2.0", PROTOCOL_VERSION],
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
      image: reference("image", "l"),
      imageOutput: reference("image-output", "m"),
      package: reference("package", "d"),
      packageOutput: reference("package-output", "e"),
      tsaProfile: reference("tsa-profile", "n"),
      timestampPackageOutput: reference("timestamp-package-output", "o"),
      reportOutput: reference("report-output", "f"),
      task: reference("task", "g"),
      result: reference("result", "h"),
      diagnostic: reference("diagnostic", "i"),
      provider: reference("provider-installation", "j"),
      session: reference("creation-session", "k"),
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
      workbenchVersion: WORKBENCH_VERSION,
      contractVersion: HOST_CONTRACT_VERSION,
      nativeApiVersion: NATIVE_API_VERSION,
      engineVersion: NATIVE_ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      supportedProtocolVersions: ["0.2.0", PROTOCOL_VERSION],
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
    const snapshot = {
      snapshot_version: "1.0.0",
      provider: "comfyui-local",
      provider_version: "0.27.0",
      workflow_template_id: "comfyui-core-text-to-image-v1",
      workflow_template_sha256:
        "623d53adee2d221ea3fd62ffa2749466e742c948d190eed7c00f39db1cba4206",
      checkpoint_observation: "model.safetensors",
      seed: 42,
      parameters: {
        width: 512,
        height: 512,
        steps: 20,
        cfg: 7,
        sampler: "euler",
        scheduler: "normal",
      },
      prompt_disclosure: "included",
      prompt: "mountain",
      negative_prompt: "text",
      prompt_sha256: "2".repeat(64),
      negative_prompt_sha256: "3".repeat(64),
      parameters_sha256: "4".repeat(64),
      snapshot_sha256: "5".repeat(64),
    };
    const provider = {
      reference: references.provider,
      displayPath: "C:\\ComfyUI",
      provider: "comfyui-local",
      detectedVersion: "0.27.0",
      endpoint: "http://127.0.0.1:8188",
      compatible: true,
      checkpoints: ["model.safetensors"],
      customNodeCount: 0,
      license: {
        name: "GNU General Public License v3.0",
        spdx: "GPL-3.0-only",
        sha256: "6".repeat(64),
      },
    };
    const session = {
      reference: references.session,
      title: "creation",
      state: "frozen",
      workspace: references.workspace,
      workspaceDisplayPath: "C:\\workspace",
      providerInstallation: references.provider,
      providerVersion: "0.27.0",
      createdAt: "2026-07-14T00:00:00Z",
      updatedAt: "2026-07-14T00:00:01Z",
      snapshot,
      progress: {
        completedUnits: 0,
        totalUnits: 100,
        message: "frozen",
      },
    };
    const valid: Record<string, unknown> = {
      getDiagnostics: { ok: true, data: diagnostics },
      chooseProviderInstallation: references.provider,
      inspectProviderInstallation: { ok: true, data: provider },
      createCreationSession: { ok: true, data: session },
      getCreationSessions: { ok: true, data: [session] },
      freezeCreationSession: { ok: true, data: session },
      runCreationSession: { ok: true, data: session },
      cancelCreationSession: { ok: true, data: session },
      completeCreationProof: { ok: true, data: session },
      chooseWorkspaceParent: references.parent,
      chooseExistingWorkspace: references.workspace,
      chooseAsset: references.asset,
      chooseImage: references.image,
      chooseCreationOutput: references.imageOutput,
      choosePackage: references.package,
      choosePackageOutput: references.packageOutput,
      chooseTsaProfile: references.tsaProfile,
      chooseTimestampPackageOutput: references.timestampPackageOutput,
      chooseReportOutput: references.reportOutput,
      importTsaProfile: {
        ok: true,
        data: {
          profile_sha256: "6".repeat(64),
          source_label: "Test TSA",
          endpoint: "https://tsa.example.test/rfc3161",
          endpoint_scope: "public_https",
          allowed_policy_oids: ["1.2.3.4.1"],
          root_count: 1,
          intermediate_count: 0,
          https_root_count: 1,
          revocation_evidence_count: 0,
          effective_at: "2026-01-01T00:00:00Z",
          expires_at: "2027-01-01T00:00:00Z",
        },
      },
      getTsaProfileStatus: { ok: true, data: null },
      requestTrustedTimestamp: {
        ok: true,
        data: {
          package: references.package,
          displayPath: "C:\\timestamped.aigcproof",
          trustedTime: "2026-07-13T00:00:01Z",
          disclosure: {
            endpoint: "https://tsa.example.test/rfc3161",
            content_type: "application/timestamp-query",
            message_imprint_sha256: "6".repeat(64),
            nonce: "7".repeat(32),
            requested_policy: "1.2.3.4.1",
            tsa_profile_sha256: "6".repeat(64),
          },
        },
      },
      cancelTrustedTimestamp: { ok: true, data: { cancelled: false } },
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
      exportCreationOutput: {
        ok: true,
        data: {
          image: references.image,
          displayPath: "C:\\created.png",
          mediaType: "image/png",
          sizeBytes: 1,
          sha256: "0".repeat(64),
        },
      },
      matchImageToPackage: {
        ok: true,
        data: {
          status: "verified_output_match",
          verification: report,
          image: {
            displayLabel: "created.png",
            displayPath: "C:\\created.png",
            mediaType: "image/png",
            sizeBytes: 1,
            sha256: "0".repeat(64),
            previewDataUrl: "data:image/png;base64,aGVsbG8=",
          },
          matchedAssets: [{ ...asset, role: "output" }],
        },
      },
      recordEvent: { ok: true, data: { event } },
      getSignerStatus: {
        ok: true,
        data: {
          state: "active",
          display_label: "Local creator",
          key_fingerprint: "9".repeat(64),
          warning_codes: [],
        },
      },
      createSigner: {
        ok: true,
        data: {
          state: "active",
          display_label: "Local creator",
          key_fingerprint: "9".repeat(64),
          warning_codes: [],
        },
      },
      rotateSigner: {
        ok: true,
        data: {
          state: "active",
          display_label: "Local creator",
          key_fingerprint: "8".repeat(64),
          warning_codes: [],
        },
      },
      disableSigner: {
        ok: true,
        data: {
          state: "disabled",
          display_label: "Local creator",
          key_fingerprint: "8".repeat(64),
          warning_codes: [],
        },
      },
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
