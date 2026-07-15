import {
  NATIVE_API_VERSION,
  NATIVE_CAPABILITIES,
  NATIVE_ENGINE_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_LIMITS,
} from "@aigc-proof/host-contracts";
import { describe, expect, it } from "vitest";

import {
  UTILITY_PROTOCOL_VERSION,
  mainToUtilityMessageSchema,
  utilityToMainMessageSchema,
} from "./utility-protocol";

describe("versioned Main/Utility messages", () => {
  it("accepts only bounded operation DTOs without renderer references or bytes", () => {
    const message = {
      version: UTILITY_PROTOCOL_VERSION,
      type: "execute",
      jobId: `job_${"a".repeat(32)}`,
      job: { operation: "loadWorkspace", payload: { path: "C:\\workspace" } },
    };
    expect(mainToUtilityMessageSchema.parse(message)).toEqual(message);
    expect(() =>
      mainToUtilityMessageSchema.parse({
        ...message,
        job: {
          ...message.job,
          payload: { ...message.job.payload, bytes: new Uint8Array(1) },
        },
      }),
    ).toThrow();
    expect(() =>
      mainToUtilityMessageSchema.parse({ ...message, version: "2.0.0" }),
    ).toThrow();
  });

  it("strictly validates handshake facts, limits, progress, and results", () => {
    const ready = {
      version: UTILITY_PROTOCOL_VERSION,
      type: "ready",
      nativeApiVersion: NATIVE_API_VERSION,
      discovery: {
        apiVersion: NATIVE_API_VERSION,
        engineVersion: NATIVE_ENGINE_VERSION,
        supportedProtocolVersions: ["0.2.0", PROTOCOL_VERSION],
        capabilities: [...NATIVE_CAPABILITIES],
        execution: {
          napiAsyncTasks: true,
          utilityProcessIsolation: true,
          progressStreaming: true,
          safeCancellation: false,
        },
        limits: RUNTIME_LIMITS,
      },
    };
    expect(utilityToMainMessageSchema.parse(ready)).toEqual(ready);
    expect(() =>
      utilityToMainMessageSchema.parse({ ...ready, extra: true }),
    ).toThrow();
  });

  it("passes only bounded paths and identifiers for image match and export", () => {
    const base = {
      version: UTILITY_PROTOCOL_VERSION,
      type: "execute" as const,
      jobId: `job_${"b".repeat(32)}`,
    };
    expect(
      mainToUtilityMessageSchema.parse({
        ...base,
        job: {
          operation: "matchImageToPackage",
          payload: { package: "C:\\proof.aigcproof", image: "C:\\image.png" },
        },
      }),
    ).toBeTruthy();
    expect(
      mainToUtilityMessageSchema.parse({
        ...base,
        job: {
          operation: "exportWorkspaceOutput",
          payload: {
            workspace: "C:\\workspace",
            assetId: "asset-output",
            output: "C:\\saved.png",
          },
        },
      }),
    ).toBeTruthy();
    expect(() =>
      mainToUtilityMessageSchema.parse({
        ...base,
        job: {
          operation: "matchImageToPackage",
          payload: {
            package: "C:\\proof.aigcproof",
            image: "C:\\image.png",
            bytes: "not-allowed",
          },
        },
      }),
    ).toThrow();
  });
});
