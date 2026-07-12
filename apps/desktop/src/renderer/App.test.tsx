import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AigcProofApi } from "../shared/contracts";
import { App } from "./App";

const state = {
  schemaVersion: 1,
  preferences: {},
  recentWorkspaces: [],
  recentPackages: [],
};

const workspaceSummary = {
  path: "C:\\workspace\\项目 test",
  workspace: {
    workspace_version: "0.2.0" as const,
    created_at: "2026-07-12T00:00:00Z",
    project: { name: "Test" },
    assets: [],
  },
};

beforeEach(() => {
  window.aigcProof = {
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
  } as unknown as AigcProofApi;
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
    expect(screen.getByText("Workbench 0.1.1")).toBeInTheDocument();
  });

  it("creates only from a Main-resolved parent and folder name", async () => {
    const user = userEvent.setup();
    vi.mocked(window.aigcProof.chooseWorkspaceParent).mockResolvedValue(
      "C:\\workspace",
    );
    vi.mocked(window.aigcProof.previewWorkspaceTarget).mockResolvedValue({
      ok: true,
      data: {
        parent: "C:\\workspace",
        folderName: "项目 test",
        path: workspaceSummary.path,
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
        workspaceSummary.path,
      ),
    );
    await user.click(screen.getByTestId("init-workspace"));

    expect(window.aigcProof.initializeWorkspace).toHaveBeenCalledWith({
      parent: "C:\\workspace",
      folderName: "项目 test",
    });
  });

  it("disables creation and shows safe guidance for an existing target", async () => {
    const user = userEvent.setup();
    vi.mocked(window.aigcProof.chooseWorkspaceParent).mockResolvedValue(
      "C:\\workspace",
    );
    vi.mocked(window.aigcProof.previewWorkspaceTarget).mockResolvedValue({
      ok: true,
      data: {
        parent: "C:\\workspace",
        folderName: "existing",
        path: "C:\\workspace\\existing",
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
      workspaceSummary.path,
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
      path: workspaceSummary.path,
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
