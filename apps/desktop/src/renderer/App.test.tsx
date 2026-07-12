import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AigcProofApi } from "../shared/contracts";
import { App } from "./App";

const state = {
  schemaVersion: 1,
  preferences: {},
  recentWorkspaces: [],
  recentPackages: [],
};

beforeEach(() => {
  window.aigcProof = {
    getState: vi.fn().mockResolvedValue({ ok: true, data: state }),
    setPreference: vi.fn().mockResolvedValue({ ok: true, data: state }),
    chooseWorkspace: vi.fn(),
    chooseAsset: vi.fn(),
    choosePackage: vi.fn(),
    choosePackageOutput: vi.fn(),
    chooseReportOutput: vi.fn(),
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
    expect(screen.getByText("Workbench 0.1.0")).toBeInTheDocument();
  });
});
