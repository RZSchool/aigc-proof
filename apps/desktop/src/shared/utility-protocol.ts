import { z } from "zod";

import {
  NATIVE_API_VERSION,
  type HostEnvelope,
  type NativeDiscovery,
  hostEnvelopeSchema,
  nativeDiscoverySchema,
} from "@aigc-proof/host-contracts";

export const UTILITY_PROTOCOL_VERSION = "1.0.0" as const;

const jobIdSchema = z.string().regex(/^job_[A-Za-z0-9_-]{20,128}$/u);
const localPathSchema = z.string().min(1).max(32_767);

export const utilityOperations = [
  "initializeWorkspace",
  "loadWorkspace",
  "addAsset",
  "recordEvent",
  "sealPackage",
  "verifyPackage",
  "inspectPackage",
  "validateRecents",
] as const;
export type UtilityOperation = (typeof utilityOperations)[number];

const initializePayloadSchema = z
  .object({
    path: localPathSchema,
    projectName: z.string().min(1).max(200).optional(),
  })
  .strict();
const pathPayloadSchema = z.object({ path: localPathSchema }).strict();
const addAssetPayloadSchema = z
  .object({
    workspace: localPathSchema,
    source: localPathSchema,
    role: z.enum(["input", "output", "reference", "license", "other"]),
  })
  .strict();
const eventPayloadSchema = z
  .object({
    workspace: localPathSchema,
    eventType: z.string().min(1).max(100),
    payloadJson: z
      .string()
      .min(2)
      .max(16 * 1024 * 1024),
  })
  .strict();
const sealPayloadSchema = z
  .object({ workspace: localPathSchema, output: localPathSchema })
  .strict();
const recentCandidateSchema = z
  .object({ kind: z.enum(["workspace", "package"]), path: localPathSchema })
  .strict();

export const utilityJobSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("initializeWorkspace"),
      payload: initializePayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("loadWorkspace"),
      payload: pathPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("addAsset"),
      payload: addAssetPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("recordEvent"),
      payload: eventPayloadSchema,
    })
    .strict(),
  z
    .object({ operation: z.literal("sealPackage"), payload: sealPayloadSchema })
    .strict(),
  z
    .object({
      operation: z.literal("verifyPackage"),
      payload: pathPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspectPackage"),
      payload: pathPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("validateRecents"),
      payload: z
        .object({ items: z.array(recentCandidateSchema).max(40) })
        .strict(),
    })
    .strict(),
]);
export type UtilityJob = z.infer<typeof utilityJobSchema>;

export const mainToUtilityMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      version: z.literal(UTILITY_PROTOCOL_VERSION),
      type: z.literal("execute"),
      jobId: jobIdSchema,
      job: utilityJobSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(UTILITY_PROTOCOL_VERSION),
      type: z.literal("shutdown"),
    })
    .strict(),
  z
    .object({
      version: z.literal(UTILITY_PROTOCOL_VERSION),
      type: z.literal("qa-crash"),
    })
    .strict(),
]);
export type MainToUtilityMessage = z.infer<typeof mainToUtilityMessageSchema>;

export const utilityToMainMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      version: z.literal(UTILITY_PROTOCOL_VERSION),
      type: z.literal("ready"),
      nativeApiVersion: z.literal(NATIVE_API_VERSION),
      discovery: nativeDiscoverySchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(UTILITY_PROTOCOL_VERSION),
      type: z.literal("progress"),
      jobId: jobIdSchema,
      sequence: z.number().int().positive(),
      completedUnits: z.number().int().min(0).max(100),
      message: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      version: z.literal(UTILITY_PROTOCOL_VERSION),
      type: z.literal("result"),
      jobId: jobIdSchema,
      envelope: hostEnvelopeSchema,
    })
    .strict(),
]);
export type UtilityToMainMessage = z.infer<typeof utilityToMainMessageSchema>;

export interface UtilityReadyMessage {
  discovery: NativeDiscovery;
}

export interface UtilityExecutionResult {
  envelope: HostEnvelope<unknown>;
}
