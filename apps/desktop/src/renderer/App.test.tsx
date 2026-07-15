import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOST_CAPABILITIES,
  RUNTIME_LIMITS,
  UNAVAILABLE_FEATURES,
  type CreationSessionSummary,
  type ImageReference,
  type PackageReference,
  type ProofHostApi,
  type TimestampPackageOutputReference,
  type TsaProfileReference,
  type WorkspaceParentReference,
  type WorkspaceReference,
} from "../shared/contracts";
import { App } from "./App";
import { DeterministicMockProofHost } from "./mock-host";

const state = {
  schemaVersion: 1,
  preferences: {},
  recentWorkspaces: [],
  recentPackages: [],
};

const parentReference: WorkspaceParentReference = {
  id: `ref_${"a".repeat(32)}`,
  kind: "workspace-parent",
  displayLabel: "workspace",
  displayPath: "C:\\workspace",
};
const workspaceReference: WorkspaceReference = {
  id: `ref_${"b".repeat(32)}`,
  kind: "workspace",
  displayLabel: "项目 test",
  displayPath: "C:\\workspace\\项目 test",
};

const workspaceSummary = {
  reference: workspaceReference,
  displayPath: "C:\\workspace\\项目 test",
  workspace: {
    workspace_version: "0.2.0" as const,
    created_at: "2026-07-12T00:00:00Z",
    project: { name: "Test" },
    assets: [],
  },
};

const workspaceReferenceB: WorkspaceReference = {
  id: `ref_${"c".repeat(32)}`,
  kind: "workspace",
  displayLabel: "项目 B",
  displayPath: "C:\\workspace\\项目 B",
};

const packageReference: PackageReference = {
  id: `ref_${"e".repeat(32)}`,
  kind: "package",
  displayLabel: "signed.aigcproof",
  displayPath: "C:\\proofs\\signed.aigcproof",
};
const timestampedPackageReference: PackageReference = {
  id: `ref_${"f".repeat(32)}`,
  kind: "package",
  displayLabel: "timestamped.aigcproof",
  displayPath: "C:\\proofs\\timestamped.aigcproof",
};
const tsaProfileReference: TsaProfileReference = {
  id: `ref_${"1".repeat(32)}`,
  kind: "tsa-profile",
  displayLabel: "Local TSA trust snapshot",
  displayPath: "C:\\proofs\\local-tsa.json",
};
const timestampOutputReference: TimestampPackageOutputReference = {
  id: `ref_${"2".repeat(32)}`,
  kind: "timestamp-package-output",
  displayLabel: "timestamped.aigcproof",
  displayPath: "C:\\proofs\\timestamped.aigcproof",
};

const workspaceSummaryB = {
  ...workspaceSummary,
  reference: workspaceReferenceB,
  displayPath: workspaceReferenceB.displayPath!,
  workspace: {
    ...workspaceSummary.workspace,
    project: { name: "Test B" },
  },
};

const validReport = {
  spec_version: "0.2.0" as const,
  proof_id: "urn:uuid:test-proof",
  verified_at: "2026-07-15T00:00:00Z",
  status: "valid" as const,
  assurance: {
    internal_integrity: "valid" as const,
    creator_identity: "not_verified" as const,
    digital_signature: "not_present" as const,
    trusted_time: "not_present" as const,
    originality: "not_evaluated" as const,
  },
  checks: [],
  errors: [],
  warnings: [],
};

function completedSession(
  workspace: WorkspaceReference,
  marker: string,
  title: string,
): CreationSessionSummary {
  const packageReference: PackageReference = {
    id: `ref_${marker.repeat(32)}`,
    kind: "package",
    displayLabel: `${title}.aigcproof`,
    displayPath: `C:\\proofs\\${title}.aigcproof`,
  };
  return {
    reference: {
      id: `ref_${marker.toUpperCase().repeat(32)}`,
      kind: "creation-session",
      displayLabel: title,
    },
    title,
    state: "complete",
    workspace,
    workspaceDisplayPath: workspace.displayPath!,
    providerInstallation: {
      id: `ref_${"p".repeat(32)}`,
      kind: "provider-installation",
      displayLabel: "ComfyUI",
      displayPath: "C:\\ComfyUI",
    },
    providerVersion: "0.27.0",
    createdAt: `2026-07-15T00:00:0${marker === "d" ? "1" : "2"}Z`,
    updatedAt: `2026-07-15T00:00:1${marker === "d" ? "1" : "2"}Z`,
    output: {
      asset: {
        asset_id: `asset-${marker}`,
        role: "output",
        package_path: `assets/${marker}.png`,
        original_name: `${title}.png`,
        media_type: "image/png",
        size_bytes: 16,
        sha256: marker.repeat(64),
      },
      mediaType: "image/png",
      sizeBytes: 16,
      sha256: marker.repeat(64),
      previewDataUrl: "data:image/png;base64,aGVsbG8=",
    },
    package: packageReference,
    packageDisplayPath: packageReference.displayPath,
    reportDisplayPath: `C:\\proofs\\${title}.json`,
    verification: validReport,
  };
}

beforeEach(() => {
  window.aigcProof = {
    getDiagnostics: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        hostKind: "standalone",
        reference: {
          id: `ref_${"d".repeat(32)}`,
          kind: "diagnostic",
          displayLabel: "diagnostics",
        },
        workbenchVersion: "0.7.0",
        contractVersion: "1.6.0",
        nativeApiVersion: "1.5.0",
        engineVersion: "0.4.0",
        protocolVersion: "0.4.0",
        supportedProtocolVersions: ["0.2.0", "0.3.0", "0.4.0"],
        capabilities: [...HOST_CAPABILITIES],
        execution: {
          napiAsyncTasks: true,
          utilityProcessIsolation: true,
          progressStreaming: true,
          safeCancellation: false,
        },
        limits: RUNTIME_LIMITS,
        utility: { state: "healthy", generation: 1, processId: 4242 },
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      },
    }),
    getState: vi.fn().mockResolvedValue({ ok: true, data: state }),
    getCreationSessions: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    subscribeCreationEvents: vi.fn().mockReturnValue(() => undefined),
    chooseProviderInstallation: vi.fn(),
    inspectProviderInstallation: vi.fn(),
    createCreationSession: vi.fn(),
    freezeCreationSession: vi.fn(),
    runCreationSession: vi.fn(),
    cancelCreationSession: vi.fn(),
    completeCreationProof: vi.fn(),
    setPreference: vi.fn().mockResolvedValue({ ok: true, data: state }),
    chooseWorkspaceParent: vi.fn(),
    chooseExistingWorkspace: vi.fn(),
    chooseAsset: vi.fn(),
    chooseImage: vi.fn(),
    chooseCreationOutput: vi.fn(),
    choosePackage: vi.fn(),
    choosePackageOutput: vi.fn(),
    chooseTsaProfile: vi.fn(),
    chooseTimestampPackageOutput: vi.fn(),
    chooseReportOutput: vi.fn(),
    importTsaProfile: vi.fn(),
    getTsaProfileStatus: vi.fn().mockResolvedValue({ ok: true, data: null }),
    requestTrustedTimestamp: vi.fn(),
    cancelTrustedTimestamp: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { cancelled: false } }),
    previewWorkspaceTarget: vi.fn(),
    initializeWorkspace: vi.fn(),
    loadWorkspace: vi.fn(),
    addAsset: vi.fn(),
    exportCreationOutput: vi.fn(),
    matchImageToPackage: vi.fn(),
    recordEvent: vi.fn(),
    getSignerStatus: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        state: "active",
        display_label: "Test creator",
        key_fingerprint: "2".repeat(64),
        warning_codes: [],
      },
    }),
    createSigner: vi.fn(),
    rotateSigner: vi.fn(),
    disableSigner: vi.fn(),
    sealPackage: vi.fn(),
    verifyPackage: vi.fn(),
    inspectPackage: vi.fn(),
    saveReport: vi.fn(),
    rebuildRecents: vi.fn(),
    startJob: vi.fn(),
    getJobs: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getJobResult: vi.fn(),
    cancelJob: vi.fn(),
    subscribeJobEvents: vi.fn().mockReturnValue(() => undefined),
    closeApp: vi.fn(),
  } as unknown as ProofHostApi;
});

describe("workbench shell", () => {
  it("keeps the exact signed-local-identity assurance boundary visible", async () => {
    render(<App />);
    expect(screen.getByTestId("assurance-banner")).toHaveTextContent(
      "内部完整性、本地创建者数字签名与可选可信时间",
    );
    expect(screen.getByTestId("assurance-banner")).toHaveTextContent(
      "显示名称为自我声明",
    );
    expect(screen.getByText("Workbench 0.7.0")).toBeInTheDocument();
    expect(
      screen.getByTestId("unified-workflow").querySelectorAll("[data-region]"),
    ).toHaveLength(10);
    expect(document.querySelector("nav")).not.toBeInTheDocument();
    expect(window.aigcProof.getCreationSessions).not.toHaveBeenCalled();
    expect(screen.queryByTestId("creation-output")).not.toBeInTheDocument();
  });

  it("shows exact compatible versions and explicitly unavailable features", async () => {
    render(<App />);
    const card = await screen.findByTestId("diagnostics-card");
    expect(card).toHaveTextContent("0.4.0");
    expect(card).toHaveTextContent("1.6.0");
    expect(card).toHaveTextContent("integration.aigcstudio");
    expect(card).toHaveTextContent("execution.utility-process");
    expect(card).toHaveTextContent("operation.safe-cancellation");
    expect(card).toHaveTextContent("不是认证");
  });

  it("creates a self-asserted local signer and exposes the full fingerprint", async () => {
    const user = userEvent.setup();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => true),
    });
    vi.mocked(window.aigcProof.getSignerStatus).mockResolvedValue({
      ok: true,
      data: { state: "missing", warning_codes: [] },
    });
    vi.mocked(window.aigcProof.createSigner).mockResolvedValue({
      ok: true,
      data: {
        state: "active",
        display_label: "Local creator",
        key_fingerprint: "a".repeat(64),
        warning_codes: [],
      },
    });
    render(<App />);
    await user.type(
      await screen.findByTestId("signer-display-label"),
      "Local creator",
    );
    await user.click(screen.getByTestId("create-signer"));
    await waitFor(() =>
      expect(window.aigcProof.createSigner).toHaveBeenCalledWith({
        displayLabel: "Local creator",
      }),
    );
    expect(await screen.findByTestId("signer-state")).toHaveTextContent(
      "active",
    );
    expect(screen.getByTestId("signer-fingerprint")).toHaveValue(
      "a".repeat(64),
    );
    expect(screen.getByTestId("signer-card")).toHaveTextContent("自我声明");
    await user.click(screen.getByTestId("copy-signer-fingerprint"));
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(screen.getByTestId("result-text")).toHaveTextContent(
      "完整 SHA-256 指纹已复制",
    );
  });

  it("imports an explicit TSA trust snapshot and attaches verified trusted time", async () => {
    const user = userEvent.setup();
    const profile = {
      profile_sha256: "3".repeat(64),
      source_label: "Local test TSA",
      endpoint: "https://localhost:9443/rfc3161",
      endpoint_scope: "loopback_test" as const,
      allowed_policy_oids: ["1.2.3.4.1"],
      root_count: 1,
      intermediate_count: 0,
      https_root_count: 1,
      revocation_evidence_count: 1,
      effective_at: "2026-07-15T00:00:00Z",
      expires_at: "2027-07-15T00:00:00Z",
    };
    const timestampedReport = {
      ...validReport,
      spec_version: "0.4.0" as const,
      assurance: {
        ...validReport.assurance,
        creator_identity: "self_asserted" as const,
        digital_signature: "valid_locally_trusted" as const,
        trusted_time: "valid_trusted" as const,
      },
      trusted_time: {
        profile: "aigc-proof-rfc3161-v1",
        timestamp_path: `security/timestamps/${"4".repeat(64)}.tsr`,
        tsa_profile_sha256: profile.profile_sha256,
        requested_policy: "any",
        granted_policy: "1.2.3.4.1",
        gen_time: "2026-07-15T00:00:01Z",
        source_label: profile.source_label,
        revocation: "valid_crl" as const,
      },
    };
    vi.mocked(window.aigcProof.choosePackage).mockResolvedValue(
      packageReference,
    );
    vi.mocked(window.aigcProof.chooseTsaProfile).mockResolvedValue(
      tsaProfileReference,
    );
    vi.mocked(window.aigcProof.importTsaProfile).mockResolvedValue({
      ok: true,
      data: profile,
    });
    vi.mocked(window.aigcProof.chooseTimestampPackageOutput).mockResolvedValue(
      timestampOutputReference,
    );
    vi.mocked(window.aigcProof.requestTrustedTimestamp).mockResolvedValue({
      ok: true,
      data: {
        package: timestampedPackageReference,
        displayPath: timestampedPackageReference.displayPath!,
        trustedTime: "valid_trusted",
        disclosure: {
          endpoint: profile.endpoint,
          content_type: "application/timestamp-query",
          message_imprint_sha256: "5".repeat(64),
          nonce: "6".repeat(32),
          requested_policy: "any",
          tsa_profile_sha256: profile.profile_sha256,
        },
      },
    });
    vi.mocked(window.aigcProof.verifyPackage).mockResolvedValue({
      ok: true,
      data: timestampedReport,
    });

    render(<App />);
    await user.click(screen.getByTestId("choose-package"));
    await user.click(screen.getByTestId("import-tsa-profile"));
    expect(await screen.findByTestId("tsa-profile-summary")).toHaveTextContent(
      "Local test TSA",
    );
    await user.click(screen.getByTestId("choose-timestamp-output"));
    await user.click(screen.getByTestId("request-trusted-time"));

    await waitFor(() =>
      expect(window.aigcProof.requestTrustedTimestamp).toHaveBeenCalledWith({
        package: packageReference,
        output: timestampOutputReference,
        confirmDisclosure: true,
      }),
    );
    expect(
      await screen.findByTestId("trusted-time-evidence"),
    ).toHaveTextContent("Local test TSA");
    expect(screen.getByTestId("trusted-time-evidence")).toHaveTextContent(
      "valid_crl",
    );
  });

  it("creates only from a Main-resolved parent and folder name", async () => {
    const user = userEvent.setup();
    vi.mocked(window.aigcProof.chooseWorkspaceParent).mockResolvedValue(
      parentReference,
    );
    vi.mocked(window.aigcProof.previewWorkspaceTarget).mockResolvedValue({
      ok: true,
      data: {
        parent: parentReference,
        folderName: "项目 test",
        displayPath: workspaceSummary.displayPath,
        exists: false,
      },
    });
    vi.mocked(window.aigcProof.initializeWorkspace).mockResolvedValue({
      ok: true,
      data: workspaceSummary,
    });
    render(<App />);

    await user.click(screen.getByTestId("choose-create-parent"));
    await user.type(screen.getByTestId("workspace-folder-name"), "项目 test");
    await waitFor(() =>
      expect(screen.getByTestId("workspace-target-preview")).toHaveTextContent(
        workspaceSummary.displayPath,
      ),
    );
    await user.click(screen.getByTestId("init-workspace"));

    expect(window.aigcProof.initializeWorkspace).toHaveBeenCalledWith({
      parent: parentReference,
      folderName: "项目 test",
    });
  });

  it("disables creation and shows safe guidance for an existing target", async () => {
    const user = userEvent.setup();
    vi.mocked(window.aigcProof.chooseWorkspaceParent).mockResolvedValue(
      parentReference,
    );
    vi.mocked(window.aigcProof.previewWorkspaceTarget).mockResolvedValue({
      ok: true,
      data: {
        parent: parentReference,
        folderName: "existing",
        displayPath: "C:\\workspace\\existing",
        exists: true,
      },
    });
    render(<App />);

    await user.click(screen.getByTestId("choose-create-parent"));
    await user.type(screen.getByTestId("workspace-folder-name"), "existing");

    await waitFor(() =>
      expect(screen.getByTestId("workspace-target-preview")).toHaveTextContent(
        "目标已存在且不会修改",
      ),
    );
    expect(screen.getByTestId("init-workspace")).toBeDisabled();
    expect(window.aigcProof.initializeWorkspace).not.toHaveBeenCalled();
  });

  it("opens an existing workspace only through the separate open flow", async () => {
    const user = userEvent.setup();
    vi.mocked(window.aigcProof.chooseExistingWorkspace).mockResolvedValue(
      workspaceReference,
    );
    vi.mocked(window.aigcProof.loadWorkspace).mockResolvedValue({
      ok: true,
      data: workspaceSummary,
    });
    render(<App />);

    await user.click(screen.getByTestId("choose-open-workspace"));
    await user.click(screen.getByTestId("open-workspace"));

    expect(window.aigcProof.loadWorkspace).toHaveBeenCalledWith({
      workspace: workspaceReference,
    });
    expect(window.aigcProof.initializeWorkspace).not.toHaveBeenCalled();
  });

  it("does nothing when either purpose-specific picker is canceled", async () => {
    const user = userEvent.setup();
    vi.mocked(window.aigcProof.chooseWorkspaceParent).mockResolvedValue(null);
    vi.mocked(window.aigcProof.chooseExistingWorkspace).mockResolvedValue(null);
    render(<App />);

    await user.click(screen.getByTestId("choose-create-parent"));
    await user.click(screen.getByTestId("choose-open-workspace"));

    expect(screen.getByTestId("create-parent")).toHaveValue("");
    expect(screen.getByTestId("open-workspace-path")).toHaveValue("");
    expect(window.aigcProof.previewWorkspaceTarget).not.toHaveBeenCalled();
    expect(window.aigcProof.initializeWorkspace).not.toHaveBeenCalled();
    expect(window.aigcProof.loadWorkspace).not.toHaveBeenCalled();
  });

  it("scopes history to the opened workspace and restores only by explicit selection", async () => {
    const user = userEvent.setup();
    const sessionA = completedSession(workspaceReference, "d", "历史 A");
    const sessionB = completedSession(workspaceReferenceB, "e", "历史 B");
    vi.mocked(window.aigcProof.chooseExistingWorkspace)
      .mockResolvedValueOnce(workspaceReference)
      .mockResolvedValueOnce(workspaceReferenceB);
    vi.mocked(window.aigcProof.loadWorkspace).mockImplementation((request) =>
      Promise.resolve({
        ok: true,
        data:
          request.workspace.id === workspaceReference.id
            ? workspaceSummary
            : workspaceSummaryB,
      }),
    );
    vi.mocked(window.aigcProof.getCreationSessions).mockImplementation(
      (request) =>
        Promise.resolve({
          ok: true,
          data:
            request.workspace.id === workspaceReference.id
              ? [sessionA]
              : [sessionB],
        }),
    );
    render(<App />);

    await user.click(screen.getByTestId("choose-open-workspace"));
    await user.click(screen.getByTestId("open-workspace"));
    expect(await screen.findByText("历史 A")).toBeInTheDocument();
    expect(screen.queryByTestId("creation-output")).not.toBeInTheDocument();
    await user.click(screen.getByText("历史 A").closest("button")!);
    expect(await screen.findByTestId("creation-output")).toHaveTextContent(
      "历史 A.png",
    );

    await user.click(screen.getByTestId("choose-open-workspace"));
    await user.click(screen.getByTestId("open-workspace"));
    expect(await screen.findByText("历史 B")).toBeInTheDocument();
    expect(screen.queryByText("历史 A")).not.toBeInTheDocument();
    expect(screen.queryByTestId("creation-output")).not.toBeInTheDocument();
    expect(screen.getByTestId("package-path")).toHaveValue("");
    expect(screen.getByTestId("image-path")).toHaveValue("");
    await user.click(screen.getByText("历史 B").closest("button")!);
    expect(await screen.findByTestId("creation-output")).toHaveTextContent(
      "历史 B.png",
    );
  });

  it("clears a restored output before presenting a newly created draft", async () => {
    const user = userEvent.setup();
    const historical = completedSession(workspaceReference, "d", "旧会话");
    vi.mocked(window.aigcProof.chooseExistingWorkspace).mockResolvedValue(
      workspaceReference,
    );
    vi.mocked(window.aigcProof.loadWorkspace).mockResolvedValue({
      ok: true,
      data: workspaceSummary,
    });
    vi.mocked(window.aigcProof.getCreationSessions).mockResolvedValue({
      ok: true,
      data: [historical],
    });
    const provider = {
      reference: {
        id: `ref_${"p".repeat(32)}`,
        kind: "provider-installation" as const,
        displayLabel: "ComfyUI",
        displayPath: "C:\\ComfyUI",
      },
      displayPath: "C:\\ComfyUI",
      provider: "comfyui-local" as const,
      detectedVersion: "0.27.0",
      endpoint: "http://127.0.0.1:8188" as const,
      compatible: true as const,
      checkpoints: ["model.safetensors"],
      customNodeCount: 0,
      license: {
        name: "GNU General Public License v3.0" as const,
        spdx: "GPL-3.0-only" as const,
        sha256: "a".repeat(64),
      },
    };
    vi.mocked(window.aigcProof.chooseProviderInstallation).mockResolvedValue(
      provider.reference,
    );
    vi.mocked(window.aigcProof.inspectProviderInstallation).mockResolvedValue({
      ok: true,
      data: provider,
    });
    vi.mocked(window.aigcProof.createCreationSession).mockResolvedValue({
      ok: true,
      data: {
        ...historical,
        reference: {
          id: `ref_${"n".repeat(32)}`,
          kind: "creation-session",
          displayLabel: "新会话",
        },
        title: "新会话",
        state: "draft",
        output: undefined,
        package: undefined,
        packageDisplayPath: undefined,
        reportDisplayPath: undefined,
        verification: undefined,
      },
    });
    render(<App />);

    await user.click(screen.getByTestId("choose-open-workspace"));
    await user.click(screen.getByTestId("open-workspace"));
    await user.click((await screen.findByText("旧会话")).closest("button")!);
    expect(await screen.findByTestId("creation-output")).toBeInTheDocument();
    await user.click(screen.getByTestId("choose-provider"));
    await user.click(screen.getByTestId("inspect-provider"));
    await screen.findByTestId("provider-card");
    await user.clear(screen.getByTestId("creation-title"));
    await user.type(screen.getByTestId("creation-title"), "新会话");
    await user.click(screen.getByTestId("create-creation-session"));

    await waitFor(() =>
      expect(screen.getByTestId("creation-state")).toHaveTextContent("draft"),
    );
    expect(screen.queryByTestId("creation-output")).not.toBeInTheDocument();
    expect(screen.getByTestId("package-path")).toHaveValue("");
    expect(screen.queryByTestId("verification-card")).not.toBeInTheDocument();
  });

  it("keeps export prefill current-session-only and preserves it when a save picker is canceled", async () => {
    const user = userEvent.setup();
    const first = completedSession(workspaceReference, "d", "会话一");
    const second = completedSession(workspaceReference, "e", "会话二");
    vi.mocked(window.aigcProof.chooseExistingWorkspace).mockResolvedValue(
      workspaceReference,
    );
    vi.mocked(window.aigcProof.loadWorkspace).mockResolvedValue({
      ok: true,
      data: workspaceSummary,
    });
    vi.mocked(window.aigcProof.getCreationSessions).mockResolvedValue({
      ok: true,
      data: [first, second],
    });
    const imageOutput = {
      id: `ref_${"o".repeat(32)}`,
      kind: "image-output" as const,
      displayLabel: "saved.png",
      displayPath: "C:\\saved.png",
    };
    const image: ImageReference = {
      id: `ref_${"i".repeat(32)}`,
      kind: "image",
      displayLabel: "saved.png",
      displayPath: "C:\\saved.png",
    };
    vi.mocked(window.aigcProof.chooseCreationOutput)
      .mockResolvedValueOnce(imageOutput)
      .mockResolvedValueOnce(null);
    vi.mocked(window.aigcProof.exportCreationOutput).mockResolvedValue({
      ok: true,
      data: {
        image,
        displayPath: image.displayPath!,
        mediaType: "image/png",
        sizeBytes: 16,
        sha256: "d".repeat(64),
      },
    });
    vi.mocked(window.aigcProof.choosePackage).mockResolvedValue(null);
    render(<App />);

    await user.click(screen.getByTestId("choose-open-workspace"));
    await user.click(screen.getByTestId("open-workspace"));
    await user.click((await screen.findByText("会话一")).closest("button")!);
    await user.click(screen.getByTestId("export-creation-output"));
    expect(await screen.findByTestId("image-prefill-note")).toBeInTheDocument();
    expect(screen.getByTestId("image-path")).toHaveValue("C:\\saved.png");
    const successfulResult = screen.getByTestId("result-text").textContent;

    await user.click(screen.getByTestId("export-creation-output"));
    expect(screen.getByTestId("image-path")).toHaveValue("C:\\saved.png");
    expect(screen.getByTestId("result-text").textContent).toBe(
      successfulResult,
    );
    const packageBeforeCancel = (
      screen.getByTestId("package-path") as HTMLInputElement
    ).value;
    await user.click(screen.getByTestId("choose-image-package"));
    expect(screen.getByTestId("package-path")).toHaveValue(
      packageBeforeCancel ?? "",
    );

    await user.click(screen.getByText("会话二").closest("button")!);
    expect(screen.queryByTestId("image-prefill-note")).not.toBeInTheDocument();
    expect(screen.getByTestId("image-path")).toHaveValue("");
  });

  it("keeps manual proof tools collapsed and unnumbered with one integrated completion action", async () => {
    const user = userEvent.setup();
    render(<App />);
    const summary = screen.getByText("高级：手工证明工具").closest("summary")!;
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(
      [...document.querySelectorAll(".panel-title > span")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["01", "02", "03"]);
    expect(summary.tagName).toBe("SUMMARY");
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(details).toHaveTextContent("记录自定义创作事件");
    expect(details).toHaveTextContent("手工封装证明包");

    const creationPanel = document.querySelector('[data-region="creation"]')!;
    const integratedCompletion = [
      ...creationPanel.querySelectorAll("button.primary"),
    ].filter((button) => /封装|验证|报告/u.test(button.textContent ?? ""));
    expect(integratedCompletion).toHaveLength(1);
    expect(integratedCompletion[0]).toHaveAttribute(
      "data-testid",
      "complete-creation-proof",
    );
    expect(screen.getByTestId("seal-package")).toHaveClass("secondary");
  });

  it("keeps real-product creation-to-proof controls on the same page and auto-ingests mock output", async () => {
    const user = userEvent.setup();
    const host = new DeterministicMockProofHost();
    render(<App host={host} />);

    await user.click(screen.getByTestId("choose-create-parent"));
    await user.type(screen.getByTestId("workspace-folder-name"), "creation");
    await waitFor(() =>
      expect(screen.getByTestId("init-workspace")).toBeEnabled(),
    );
    await user.click(screen.getByTestId("init-workspace"));
    await user.click(screen.getByTestId("choose-provider"));
    await user.click(screen.getByTestId("inspect-provider"));
    await screen.findByTestId("provider-card");
    await user.click(screen.getByTestId("create-creation-session"));
    await user.type(screen.getByTestId("creation-prompt"), "local prompt");
    await user.click(screen.getByTestId("freeze-creation-session"));
    await user.click(screen.getByTestId("run-creation-session"));

    expect(await screen.findByTestId("creation-output")).toHaveTextContent(
      "已作为 output 自动加入证明工作区",
    );
    await user.click(screen.getByTestId("choose-creation-package-output"));
    await user.click(screen.getByTestId("choose-creation-report-output"));
    expect(screen.getByTestId("complete-creation-proof")).toBeDisabled();
    await user.click(screen.getByTestId("confirm-creation-signature"));
    expect(screen.getByTestId("complete-creation-proof")).toBeEnabled();
    await user.click(screen.getByTestId("complete-creation-proof"));
    await waitFor(() =>
      expect(screen.getByTestId("creation-state")).toHaveTextContent(
        "complete",
      ),
    );
    await user.click(screen.getByTestId("export-creation-output"));
    expect(screen.getByTestId("image-path")).toHaveValue("MOCK:/created.png");
    await user.click(screen.getByTestId("match-image-package"));
    expect(await screen.findByTestId("image-match-result")).toHaveTextContent(
      "图片与包内生成输出完全一致",
    );
    expect(screen.getByTestId("unified-workflow")).toContainElement(
      screen.getByTestId("creation-review"),
    );
  });
});
