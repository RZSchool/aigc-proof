import { describe, expect, it } from "vitest";

import {
  addAssetRequest,
  initializeWorkspaceRequest,
  setPreferenceRequest,
  workspaceTargetRequest,
} from "./schemas";

describe("IPC request schemas", () => {
  it("rejects unexpected renderer fields", () => {
    expect(() =>
      initializeWorkspaceRequest.parse({
        parent: "C:\\proof",
        folderName: "project",
        command: "calc.exe",
      }),
    ).toThrow();
    expect(() =>
      initializeWorkspaceRequest.parse({
        parent: "C:\\proof",
        folderName: "project",
        path: "C:\\proof\\renderer-chosen-target",
      }),
    ).toThrow();
  });

  it("accepts only one portable new-workspace folder component", () => {
    expect(
      workspaceTargetRequest.parse({
        parent: "C:\\workspace with space",
        folderName: "项目 test",
      }),
    ).toBeTruthy();
    for (const folderName of [
      "",
      ".",
      "..",
      "nested/name",
      "nested\\name",
      "NUL.txt",
      "tail.",
      "tail ",
      "x".repeat(121),
    ]) {
      expect(() =>
        workspaceTargetRequest.parse({
          parent: "C:\\workspace",
          folderName,
        }),
      ).toThrow();
    }
  });

  it("allows only the five protocol asset roles", () => {
    expect(
      addAssetRequest.parse({ workspace: "w", source: "f", role: "license" }),
    ).toBeTruthy();
    expect(() =>
      addAssetRequest.parse({ workspace: "w", source: "f", role: "admin" }),
    ).toThrow();
  });

  it("allows only named workbench preference keys", () => {
    expect(() =>
      setPreferenceRequest.parse({ key: "sql", value: "DROP TABLE" }),
    ).toThrow();
  });
});
