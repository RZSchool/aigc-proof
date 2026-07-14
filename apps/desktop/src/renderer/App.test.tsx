import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOST_CAPABILITIES,
  RUNTIME_LIMITS,
  UNAVAILABLE_FEATURES,
  type ProofHostApi,
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
        workbenchVersion: "0.5.0",
        contractVersion: "1.3.0",
        nativeApiVersion: "1.3.0",
        engineVersion: "0.2.0",
        protocolVersion: "0.2.0",
        supportedProtocolVersions: ["0.2.0"],
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
    setPreference: vi.fn().mockResolvedValue({ ok: true, data: state }),
    chooseWorkspaceParent: vi.fn(),
    chooseExistingWorkspace: vi.fn(),
    chooseAsset: vi.fn(),
    chooseImage: vi.fn(),
    chooseCreationOutput: vi.fn(),
    choosePackage: vi.fn(),
    choosePackageOutput: vi.fn(),
    chooseReportOutput: vi.fn(),
    previewWorkspaceTarget: vi.fn(),
    initializeWorkspace: vi.fn(),
    loadWorkspace: vi.fn(),
    addAsset: vi.fn(),
    exportCreationOutput: vi.fn(),
    matchImageToPackage: vi.fn(),
    recordEvent: vi.fn(),
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
  it("keeps the exact Internal Integrity assurance boundary visible", async () => {
    render(<App />);
    expect(screen.getByTestId("assurance-banner")).toHaveTextContent(
      "仅验证证明包内部完整性",
    );
    expect(screen.getByTestId("assurance-banner")).toHaveTextContent(
      "创建者身份未验证",
    );
    expect(screen.getByText("Workbench 0.5.0")).toBeInTheDocument();
    expect(
      screen.getByTestId("unified-workflow").querySelectorAll("[data-region]"),
    ).toHaveLength(10);
    expect(document.querySelector("nav")).not.toBeInTheDocument();
  });

  it("shows exact compatible versions and explicitly unavailable features", async () => {
    render(<App />);
    const card = await screen.findByTestId("diagnostics-card");
    expect(card).toHaveTextContent("0.2.0");
    expect(card).toHaveTextContent("1.3.0");
    expect(card).toHaveTextContent("integration.aigcstudio");
    expect(card).toHaveTextContent("execution.utility-process");
    expect(card).toHaveTextContent("operation.safe-cancellation");
    expect(card).toHaveTextContent("不是认证");
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
