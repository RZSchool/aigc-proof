import { describe, expect, it } from "vitest";

import {
  addAssetRequest,
  initializeWorkspaceRequest,
  setPreferenceRequest,
} from "./schemas";

describe("IPC request schemas", () => {
  it("rejects unexpected renderer fields", () => {
    expect(() =>
      initializeWorkspaceRequest.parse({
        path: "C:\\proof",
        command: "calc.exe",
      }),
    ).toThrow();
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
