import {
  NATIVE_API_VERSION,
  NATIVE_CAPABILITIES,
  NATIVE_ENGINE_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_LIMITS,
} from "@aigc-proof/host-contracts";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateNativeAddonDiscovery } from "./native-contract";

const validDiscovery = {
  apiVersion: NATIVE_API_VERSION,
  engineVersion: NATIVE_ENGINE_VERSION,
  supportedProtocolVersions: [PROTOCOL_VERSION],
  capabilities: [...NATIVE_CAPABILITIES],
  execution: {
    napiAsyncTasks: true as const,
    utilityProcessIsolation: true as const,
    progressStreaming: true as const,
    safeCancellation: false as const,
  },
  limits: RUNTIME_LIMITS,
};

describe("native compatibility gate", () => {
  it("accepts exact discovery before operations are used", () => {
    const getApiInfo = vi.fn(() => validDiscovery);
    expect(validateNativeAddonDiscovery({ getApiInfo })).toEqual(
      validDiscovery,
    );
    expect(getApiInfo).toHaveBeenCalledOnce();
  });

  it.each([
    [{}, "NATIVE_DISCOVERY_MISSING"],
    [{ getApiInfo: () => ({}) }, "NATIVE_DISCOVERY_INVALID"],
    [
      { getApiInfo: () => ({ ...validDiscovery, apiVersion: "2.0.0" }) },
      "NATIVE_API_INCOMPATIBLE",
    ],
    [
      { getApiInfo: () => ({ ...validDiscovery, capabilities: [] }) },
      "NATIVE_DISCOVERY_INVALID",
    ],
  ])("fails closed for incompatible candidate", (candidate, code) => {
    expect(() => validateNativeAddonDiscovery(candidate)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("never touches proof operations when discovery is incompatible", () => {
    const initializeWorkspace = vi.fn();
    expect(() =>
      validateNativeAddonDiscovery({
        getApiInfo: () => ({ ...validDiscovery, apiVersion: "9.0.0" }),
        initializeWorkspace,
      }),
    ).toThrow(expect.objectContaining({ code: "NATIVE_API_INCOMPATIBLE" }));
    expect(initializeWorkspace).not.toHaveBeenCalled();
  });

  it("freezes C2PA Node-API export names instead of relying on acronym casing", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../../crates/proof-napi/src/lib.rs"),
      "utf8",
    );
    for (const exportName of [
      "validateC2paProfile",
      "inspectC2paImage",
      "createWorkspaceC2paObservation",
    ]) {
      expect(source).toContain(`#[napi(js_name = "${exportName}")]`);
    }
  });
});
