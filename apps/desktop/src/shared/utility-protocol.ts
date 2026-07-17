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
  "exportWorkspaceOutput",
  "matchImageToPackage",
  "recordEvent",
  "getSignerStatus",
  "createSigner",
  "rotateSigner",
  "disableSigner",
  "sealPackage",
  "verifyPackage",
  "inspectPackage",
  "validateTsaProfile",
  "prepareTimestamp",
  "attachTimestamp",
  "validateC2paProfile",
  "inspectC2pa",
  "createC2paObservation",
  "verifyOfficialIdentity",
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
const exportWorkspaceOutputPayloadSchema = z
  .object({
    workspace: localPathSchema,
    assetId: z.string().min(1).max(160),
    output: localPathSchema,
  })
  .strict();
const matchImagePayloadSchema = z
  .object({ package: localPathSchema, image: localPathSchema })
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
  .object({
    workspace: localPathSchema,
    output: localPathSchema,
    confirmSignature: z.literal(true),
    tsaProfileJson: z
      .string()
      .max(1024 * 1024)
      .optional(),
    timestampPolicy: z.string().min(1).max(128).optional(),
  })
  .strict();
const verifyPayloadSchema = z
  .object({
    path: localPathSchema,
    tsaProfileJson: z
      .string()
      .max(1024 * 1024)
      .optional(),
  })
  .strict();
const tsaProfilePayloadSchema = z
  .object({
    profileJson: z
      .string()
      .min(2)
      .max(1024 * 1024),
  })
  .strict();
const prepareTimestampPayloadSchema = z
  .object({
    package: localPathSchema,
    profileJson: z
      .string()
      .min(2)
      .max(1024 * 1024),
  })
  .strict();
const attachTimestampPayloadSchema = z
  .object({
    package: localPathSchema,
    output: localPathSchema,
    responsePath: localPathSchema,
    profileJson: z
      .string()
      .min(2)
      .max(1024 * 1024),
  })
  .strict();
const c2paProfilePayloadSchema = z
  .object({
    profileJson: z
      .string()
      .min(2)
      .max(4 * 1024 * 1024),
  })
  .strict();
const c2paInspectPayloadSchema = z
  .object({
    asset: localPathSchema,
    sidecar: localPathSchema.optional(),
    profileJson: z
      .string()
      .min(2)
      .max(4 * 1024 * 1024)
      .optional(),
  })
  .strict();
const c2paObservationPayloadSchema = z
  .object({
    workspace: localPathSchema,
    assetId: z.string().min(1).max(160),
    sidecar: localPathSchema.optional(),
    profileJson: z
      .string()
      .min(2)
      .max(4 * 1024 * 1024),
  })
  .strict();
const officialIdentityPayloadSchema = z
  .object({
    attestationCoseBase64: z
      .string()
      .min(1)
      .max(96 * 1024),
    issuerTrustJson: z
      .string()
      .min(2)
      .max(64 * 1024),
    statusCoseBase64: z
      .string()
      .min(1)
      .max(96 * 1024)
      .optional(),
    creatorKeyFingerprint: z.string().regex(/^(?:sha256:)?[0-9a-f]{64}$/u),
    purpose: z.string().min(1).max(96),
    verificationTime: z.number().int().nonnegative(),
    minimumTrustSequence: z.number().int().positive(),
    minimumStatusSequence: z.number().int().positive(),
    expectedPreviousStatusDigest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u)
      .optional(),
    maxStatusAgeSeconds: z.number().int().min(0).max(31_536_000),
  })
  .strict();
const signerLabelPayloadSchema = z
  .object({ displayLabel: z.string().min(1).max(200) })
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
      operation: z.literal("exportWorkspaceOutput"),
      payload: exportWorkspaceOutputPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("matchImageToPackage"),
      payload: matchImagePayloadSchema,
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
      operation: z.literal("getSignerStatus"),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("createSigner"),
      payload: signerLabelPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("rotateSigner"),
      payload: signerLabelPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("disableSigner"),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("verifyPackage"),
      payload: verifyPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("validateTsaProfile"),
      payload: tsaProfilePayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("prepareTimestamp"),
      payload: prepareTimestampPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("attachTimestamp"),
      payload: attachTimestampPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("validateC2paProfile"),
      payload: c2paProfilePayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspectC2pa"),
      payload: c2paInspectPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("createC2paObservation"),
      payload: c2paObservationPayloadSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("verifyOfficialIdentity"),
      payload: officialIdentityPayloadSchema,
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
