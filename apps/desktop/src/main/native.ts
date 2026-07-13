import { createRequire } from "node:module";
import path from "node:path";

import { app } from "electron";
import { z } from "zod";

import type { HostEnvelope, NativeDiscovery } from "@aigc-proof/host-contracts";
import { validateNativeAddonDiscovery } from "./native-contract";

export interface NativeAddon {
  getApiInfo(): unknown;
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

export interface NativeRuntime {
  addon: NativeAddon;
  discovery: NativeDiscovery;
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

export function loadNativeRuntime(): NativeRuntime {
  const addon = loadNativeAddon();
  return { addon, discovery: validateNativeAddonDiscovery(addon) };
}

const nativeEnvelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          kind: z.string(),
          message: z.string(),
          path: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);

export async function invokeNative<T>(
  operation: Promise<string>,
): Promise<HostEnvelope<T>> {
  try {
    const parsed = nativeEnvelopeSchema.parse(JSON.parse(await operation));
    if (parsed.ok) return { ok: true, data: parsed.data as T };
    return {
      ok: false,
      error: {
        code: parsed.error.code,
        kind: parsed.error.kind,
        message: parsed.error.message,
        ...(parsed.error.path ? { displayPath: parsed.error.path } : {}),
      },
    };
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
