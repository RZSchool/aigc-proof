import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NATIVE_CAPABILITIES,
  UNAVAILABLE_FEATURES,
  type ProofHostApi,
  type WorkspaceParentReference,
  type WorkspaceReference,
} from "../shared/contracts";
import { App } from "./App";

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
        workbenchVersion: "0.2.0",
        contractVersion: "1.0.0",
        nativeApiVersion: "1.0.0",
        engineVersion: "0.2.0",
        protocolVersion: "0.2.0",
        supportedProtocolVersions: ["0.2.0"],
        capabilities: [...NATIVE_CAPABILITIES],
        execution: {
          napiAsyncTasks: true,
          utilityProcessIsolation: false,
          progressStreaming: false,
          safeCancellation: false,
        },
        unavailableFeatures: [...UNAVAILABLE_FEATURES],
      },
    }),
    getState: vi.fn().mockResolvedValue({ ok: true, data: state }),
    setPreference: vi.fn().mockResolvedValue({ ok: true, data: state }),
    chooseWorkspaceParent: vi.fn(),
    chooseExistingWorkspace: vi.fn(),
    chooseAsset: vi.fn(),
    choosePackage: vi.fn(),
    choosePackageOutput: vi.fn(),
    chooseReportOutput: vi.fn(),
    previewWorkspaceTarget: vi.fn(),
    initializeWorkspace: vi.fn(),
    loadWorkspace: vi.fn(),
    addAsset: vi.fn(),
    recordEvent: vi.fn(),
    sealPackage: vi.fn(),
    verifyPackage: vi.fn(),
    inspectPackage: vi.fn(),
    saveReport: vi.fn(),
    rebuildRecents: vi.fn(),
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
    expect(screen.getByText("Workbench 0.2.0")).toBeInTheDocument();
  });

  it("shows exact compatible versions and explicitly unavailable features", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("nav-settings"));
    const card = await screen.findByTestId("diagnostics-card");
    expect(card).toHaveTextContent("0.2.0");
    expect(card).toHaveTextContent("1.0.0");
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

    await user.click(screen.getByTestId("nav-workspace"));
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

    await user.click(screen.getByTestId("nav-workspace"));
    await user.click(screen.getByTestId("choose-create-parent"));
    await user.type(screen.getByTestId("workspace-folder-name"), "existing");

    await waitFor(() =>
      expect(screen.getByTestId("workspace-target-preview")).toHaveTextContent(
        "目标已存在，不会被修改",
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

    await user.click(screen.getByTestId("nav-workspace"));
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

    await user.click(screen.getByTestId("nav-workspace"));
    await user.click(screen.getByTestId("choose-create-parent"));
    await user.click(screen.getByTestId("choose-open-workspace"));

    expect(screen.getByTestId("create-parent")).toHaveValue("");
    expect(screen.getByTestId("open-workspace-path")).toHaveValue("");
    expect(window.aigcProof.previewWorkspaceTarget).not.toHaveBeenCalled();
    expect(window.aigcProof.initializeWorkspace).not.toHaveBeenCalled();
    expect(window.aigcProof.loadWorkspace).not.toHaveBeenCalled();
  });
});
