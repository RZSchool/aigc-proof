import { createRequire } from "node:module";
import path from "node:path";

import { app } from "electron";

import type { BridgeEnvelope } from "../shared/contracts";
import { bridgeEnvelopeSchema } from "../shared/schemas";

interface NativeAddon {
  initializeWorkspace(request: {
    path: string;
    projectName?: string;
  }): Promise<string>;
  loadWorkspaceSummary(request: { path: string }): Promise<string>;
  addWorkspaceAsset(request: {
    workspace: string;
    source: string;
    role: string;
  }): Promise<string>;
  recordWorkspaceEvent(request: {
    workspace: string;
    eventType: string;
    payloadJson: string;
  }): Promise<string>;
  sealProofPackage(request: {
    workspace: string;
    output: string;
  }): Promise<string>;
  verifyProofPackage(request: { path: string }): Promise<string>;
  inspectProofPackage(request: { path: string }): Promise<string>;
  initializeAppState(request: { database: string }): Promise<string>;
  getAppState(request: { database: string }): Promise<string>;
  setAppPreference(request: {
    database: string;
    key: string;
    value: string;
  }): Promise<string>;
  rememberRecentItem(request: {
    database: string;
    kind: string;
    path: string;
  }): Promise<string>;
  rebuildRecentIndexes(request: { database: string }): Promise<string>;
}

let nativeAddon: NativeAddon | undefined;
const requireNative = createRequire(__filename);

function addonPath(): string {
  const override = process.env.AIGC_PROOF_NATIVE_PATH;
  if (override) return path.resolve(override);
  return app.isPackaged
    ? path.join(process.resourcesPath, "native", "proof_napi.node")
    : path.resolve(__dirname, "../../native/proof_napi.node");
}

export function loadNativeAddon(): NativeAddon {
  nativeAddon ??= requireNative(addonPath()) as NativeAddon;
  return nativeAddon;
}

export async function invokeNative<T>(
  operation: Promise<string>,
): Promise<BridgeEnvelope<T>> {
  try {
    const parsed = bridgeEnvelopeSchema.parse(JSON.parse(await operation));
    return parsed as BridgeEnvelope<T>;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "NATIVE_BRIDGE_RESPONSE_INVALID",
        kind: "bridge",
        message:
          error instanceof Error
            ? error.message
            : "Native bridge response was invalid.",
      },
    };
  }
}
