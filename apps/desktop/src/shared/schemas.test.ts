import { describe, expect, it } from "vitest";

import {
  addAssetRequest,
  initializeWorkspaceRequest,
  setPreferenceRequest,
  workspaceTargetRequest,
} from "./schemas";

const parent = {
  id: `ref_${"a".repeat(32)}`,
  kind: "workspace-parent",
  displayLabel: "proof",
  displayPath: "C:\\proof",
};
const workspace = { ...parent, id: `ref_${"b".repeat(32)}`, kind: "workspace" };
const source = { ...parent, id: `ref_${"c".repeat(32)}`, kind: "asset" };

describe("IPC request schemas", () => {
  it("rejects unexpected renderer fields", () => {
    expect(() =>
      initializeWorkspaceRequest.parse({
        parent,
        folderName: "project",
        command: "calc.exe",
      }),
    ).toThrow();
    expect(() =>
      initializeWorkspaceRequest.parse({
        parent,
        folderName: "project",
        path: "C:\\proof\\renderer-chosen-target",
      }),
    ).toThrow();
  });

  it("accepts only one portable new-workspace folder component", () => {
    expect(
      workspaceTargetRequest.parse({
        parent,
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
          parent,
          folderName,
        }),
      ).toThrow();
    }
  });

  it("allows only the five protocol asset roles", () => {
    expect(
      addAssetRequest.parse({ workspace, source, role: "license" }),
    ).toBeTruthy();
    expect(() =>
      addAssetRequest.parse({ workspace, source, role: "admin" }),
    ).toThrow();
  });

  it("allows only named workbench preference keys", () => {
    expect(() =>
      setPreferenceRequest.parse({ key: "sql", value: "DROP TABLE" }),
    ).toThrow();
  });
});
