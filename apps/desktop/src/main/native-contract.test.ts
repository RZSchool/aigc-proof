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
      { getApiInfo: () => ({ ...validDiscovery, apiVersion: "3.0.0" }) },
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

  it("keeps trustless C2PA offline and RFC 3161 behind explicit disclosure confirmation", () => {
    const core = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../crates/proof-core/src/c2pa_bridge.rs",
      ),
      "utf8",
    );
    expect(core).toContain('"allowed_network_hosts": []');
    expect(core).toContain('"ocsp_fetch": false');
    expect(core).toContain('"remote_manifest_fetch": false');

    const ipc = fs.readFileSync(path.resolve(__dirname, "./ipc.ts"), "utf8");
    const inspectStart = ipc.indexOf("channels.inspectC2paImage");
    const observationStart = ipc.indexOf(
      "channels.createC2paObservation",
      inspectStart,
    );
    const inspectHandler = ipc.slice(inspectStart, observationStart);
    expect(inspectHandler).toContain(
      "...(profile ? { profileJson: profile.rawJson } : {})",
    );
    expect(inspectHandler).not.toContain("C2PA_TRUST_PROFILE_NOT_IMPORTED");

    const timestampStart = ipc.indexOf("channels.requestTrustedTimestamp");
    const timestampHandler = ipc.slice(timestampStart);
    for (const disclosed of [
      "prepared.disclosure.endpoint",
      "prepared.disclosure.requested_policy",
      "prepared.disclosure.message_imprint_sha256",
      "TSA_REQUEST_NOT_CONFIRMED",
    ]) {
      expect(timestampHandler).toContain(disclosed);
    }
  });
});
