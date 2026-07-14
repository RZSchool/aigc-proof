import { createRequire } from "node:module";
import path from "node:path";

import { z } from "zod";

import type { HostEnvelope } from "@aigc-proof/host-contracts";

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
  exportWorkspaceOutputAsset(request: {
    workspace: string;
    assetId: string;
    output: string;
  }): Promise<string>;
  matchImageToProofPackage(request: {
    package: string;
    image: string;
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
}

const nativeEnvelopeSchema = z.discriminatedUnion("ok", [
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

const requireNative = createRequire(__filename);

export function loadNativeAddon(): NativeAddon {
  const configured = process.env.AIGC_PROOF_NATIVE_PATH;
  if (!configured)
    throw new Error("AIGC_PROOF_NATIVE_PATH is not configured for Utility.");
  return requireNative(path.resolve(configured)) as NativeAddon;
}

export async function invokeNative(
  operation: Promise<string>,
): Promise<HostEnvelope<unknown>> {
  try {
    const parsed = nativeEnvelopeSchema.parse(JSON.parse(await operation));
    if (parsed.ok) return { ok: true, data: parsed.data };
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
