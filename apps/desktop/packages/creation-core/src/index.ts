import { createHash } from "node:crypto";

import {
  CREATION_PROVIDER_ID,
  CREATION_SNAPSHOT_VERSION,
  CREATION_TEMPLATE_ID,
  CREATION_TEMPLATE_SHA256,
  creationParametersSchema,
  creationSnapshotSchema,
  type CreationParameters,
  type CreationSessionState,
  type CreationSnapshot,
} from "@aigc-proof/host-contracts";
import { z } from "zod";

export {
  CREATION_PROVIDER_ID,
  CREATION_SNAPSHOT_VERSION,
  CREATION_TEMPLATE_ID,
  CREATION_TEMPLATE_SHA256,
  creationParametersSchema,
  creationSnapshotSchema,
  type CreationParameters,
  type CreationSnapshot,
};

export const CREATION_CORE_VERSION = "1.0.0" as const;
export const CREATION_TEMPLATE_VERSION = "1.0.0" as const;
export const CREATION_SNAPSHOT_SCHEMA_SHA256 =
  "a4ceabdf7f40d166f4977da87e5820eda6e251ce3bc974571948913187e0e824" as const;

export const REQUIRED_COMFYUI_NODE_CLASSES = [
  "CheckpointLoaderSimple",
  "CLIPTextEncode",
  "EmptyLatentImage",
  "KSampler",
  "VAEDecode",
  "SaveImage",
] as const;

export const creationSnapshotInputSchema = z
  .object({
    providerVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    checkpointObservation: z.string().trim().min(1).max(512),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 50),
    parameters: creationParametersSchema,
    promptDisclosure: z.enum(["included", "digest-only"]),
    prompt: z.string().max(32_768),
    negativePrompt: z.string().max(32_768),
  })
  .strict();
export type CreationSnapshotInput = z.infer<typeof creationSnapshotInputSchema>;

export const creationEvidenceKindSchema = z.enum([
  "session.started",
  "snapshot.frozen",
  "job.requested",
  "job.completed",
  "output.ingested",
  "proof.ready",
]);
export type CreationEvidenceKind = z.infer<typeof creationEvidenceKindSchema>;

export interface CreationEvidenceEvent {
  eventType: CreationEvidenceKind;
  payload: Record<string, unknown>;
}

export type ProviderObservation =
  | { state: "accepted"; providerJobId: string }
  | { state: "running"; providerJobId: string }
  | {
      state: "progress";
      providerJobId: string;
      completedUnits: number;
      totalUnits: number;
    }
  | {
      state: "completed";
      providerJobId: string;
      output: ProviderOutputDescriptor;
    }
  | { state: "failed"; providerJobId?: string; code: string; message: string }
  | { state: "cancelled"; providerJobId?: string };

export interface ProviderOutputDescriptor {
  filename: string;
  subfolder: string;
  type: "output";
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  sha256: string;
}

export interface ProviderOutput extends ProviderOutputDescriptor {
  bytes: Uint8Array;
}

export interface ProviderInspection {
  provider: typeof CREATION_PROVIDER_ID;
  version: string;
  endpoint: string;
  checkpoints: string[];
  nodeClasses: string[];
  customNodeCount: number;
  featuresAvailable: true;
  websocketAvailable: true;
}

export interface ProviderJobRequest {
  clientId: string;
  snapshot: CreationSnapshot;
  filenamePrefix: string;
  prompt?: string | undefined;
  negativePrompt?: string | undefined;
}

export interface CreationProvider {
  inspect(signal?: AbortSignal): Promise<ProviderInspection>;
  run(
    request: ProviderJobRequest,
    observe: (observation: ProviderObservation) => void,
    signal?: AbortSignal,
  ): Promise<ProviderOutput>;
  cancel(): Promise<void>;
}

export class CreationCoreError extends Error {
  constructor(
    public readonly code:
      | "CREATION_RELATIONSHIP_INVALID"
      | "CREATION_STATE_INVALID"
      | "PROVIDER_CANCELLED"
      | "PROVIDER_CAPABILITY_MISSING"
      | "PROVIDER_ENDPOINT_INVALID"
      | "PROVIDER_INSTALLATION_INVALID"
      | "PROVIDER_MALFORMED_OUTPUT"
      | "PROVIDER_PROCESS_LOST"
      | "PROVIDER_RESPONSE_INVALID"
      | "PROVIDER_TIMEOUT"
      | "PROVIDER_VERSION_INCOMPATIBLE",
    message: string,
  ) {
    super(message);
    this.name = "CreationCoreError";
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createCreationSnapshot(
  raw: CreationSnapshotInput,
): CreationSnapshot {
  const input = creationSnapshotInputSchema.parse(raw);
  const parameters = creationParametersSchema.parse(input.parameters);
  const withoutSnapshotDigest = {
    snapshot_version: CREATION_SNAPSHOT_VERSION,
    provider: CREATION_PROVIDER_ID,
    provider_version: input.providerVersion,
    workflow_template_id: CREATION_TEMPLATE_ID,
    workflow_template_sha256: CREATION_TEMPLATE_SHA256,
    checkpoint_observation: input.checkpointObservation,
    seed: input.seed,
    parameters,
    prompt_disclosure: input.promptDisclosure,
    ...(input.promptDisclosure === "included"
      ? { prompt: input.prompt, negative_prompt: input.negativePrompt }
      : {}),
    prompt_sha256: sha256(input.prompt),
    negative_prompt_sha256: sha256(input.negativePrompt),
    parameters_sha256: sha256(canonicalJson(parameters)),
  } as const;
  return creationSnapshotSchema.parse({
    ...withoutSnapshotDigest,
    snapshot_sha256: sha256(canonicalJson(withoutSnapshotDigest)),
  });
}

export function verifyCreationSnapshot(raw: unknown): CreationSnapshot {
  const snapshot = creationSnapshotSchema.parse(raw);
  const { snapshot_sha256: observed, ...unsigned } = snapshot;
  if (sha256(canonicalJson(unsigned)) !== observed) {
    throw new CreationCoreError(
      "CREATION_STATE_INVALID",
      "Creation snapshot digest does not match its canonical content.",
    );
  }
  return snapshot;
}

type ComfyInput = string | number | boolean | [string, number];
export type ComfyWorkflow = Record<
  string,
  {
    class_type: (typeof REQUIRED_COMFYUI_NODE_CLASSES)[number];
    inputs: Record<string, ComfyInput>;
  }
>;

const safeFileToken = /^[A-Za-z0-9_-]{1,80}$/u;

export function buildComfyUiWorkflow(
  rawSnapshot: CreationSnapshot,
  filenamePrefix: string,
  executionPrompt?: { prompt: string; negativePrompt: string },
): ComfyWorkflow {
  const snapshot = verifyCreationSnapshot(rawSnapshot);
  if (!safeFileToken.test(filenamePrefix)) {
    throw new CreationCoreError(
      "CREATION_STATE_INVALID",
      "Output filename prefix is outside the fixed safe token profile.",
    );
  }
  const prompt = snapshot.prompt ?? executionPrompt?.prompt;
  const negativePrompt =
    snapshot.negative_prompt ?? executionPrompt?.negativePrompt;
  if (
    prompt === undefined ||
    negativePrompt === undefined ||
    sha256(prompt) !== snapshot.prompt_sha256 ||
    sha256(negativePrompt) !== snapshot.negative_prompt_sha256
  ) {
    throw new CreationCoreError(
      "CREATION_STATE_INVALID",
      "Provider execution prompts are missing or do not match the frozen snapshot digests.",
    );
  }
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: snapshot.checkpoint_observation },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["1", 1],
      },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativePrompt,
        clip: ["1", 1],
      },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: snapshot.parameters.width,
        height: snapshot.parameters.height,
        batch_size: 1,
      },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: snapshot.seed,
        steps: snapshot.parameters.steps,
        cfg: snapshot.parameters.cfg,
        sampler_name: snapshot.parameters.sampler,
        scheduler: snapshot.parameters.scheduler,
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["6", 0] },
    },
  };
}

export interface EvidenceMappingInput {
  sessionId: string;
  sessionState: CreationSessionState;
  snapshot: CreationSnapshot;
  providerJobId: string;
  output: ProviderOutputDescriptor;
}

export function mapCreationEvidence(
  raw: EvidenceMappingInput,
): CreationEvidenceEvent[] {
  const snapshot = verifyCreationSnapshot(raw.snapshot);
  if (raw.sessionState !== "succeeded") {
    throw new CreationCoreError(
      "CREATION_STATE_INVALID",
      "Only a successfully completed provider session can map proof evidence.",
    );
  }
  if (!/^session_[A-Za-z0-9_-]{12,80}$/u.test(raw.sessionId)) {
    throw new CreationCoreError(
      "CREATION_RELATIONSHIP_INVALID",
      "Creation evidence requires a valid session identity.",
    );
  }
  if (!raw.providerJobId || raw.output.sizeBytes < 1) {
    throw new CreationCoreError(
      "CREATION_RELATIONSHIP_INVALID",
      "Completed provider and output observations are required for proof evidence.",
    );
  }
  const common = { session_id: raw.sessionId };
  return [
    { eventType: "session.started", payload: common },
    {
      eventType: "snapshot.frozen",
      payload: {
        ...common,
        snapshot_sha256: snapshot.snapshot_sha256,
        snapshot,
      },
    },
    {
      eventType: "job.requested",
      payload: {
        ...common,
        provider: snapshot.provider,
        provider_version: snapshot.provider_version,
        provider_job_id: raw.providerJobId,
      },
    },
    {
      eventType: "job.completed",
      payload: { ...common, provider_job_id: raw.providerJobId },
    },
    {
      eventType: "output.ingested",
      payload: {
        ...common,
        output_sha256: raw.output.sha256,
        output_size_bytes: raw.output.sizeBytes,
        output_media_type: raw.output.mediaType,
      },
    },
    {
      eventType: "proof.ready",
      payload: {
        ...common,
        snapshot_sha256: snapshot.snapshot_sha256,
        output_sha256: raw.output.sha256,
      },
    },
  ];
}

export type CreationLifecycleAction =
  | "freeze"
  | "start"
  | "provider_succeeded"
  | "evidence_ready"
  | "fail"
  | "cancel"
  | "proof_complete";

const lifecycleTransitions: Record<
  CreationSessionState,
  Partial<Record<CreationLifecycleAction, CreationSessionState>>
> = {
  draft: { freeze: "frozen" },
  frozen: { start: "running", fail: "failed" },
  running: {
    provider_succeeded: "succeeded",
    fail: "failed",
    cancel: "cancelled",
  },
  succeeded: { evidence_ready: "proof_ready", fail: "failed" },
  failed: { start: "running" },
  cancelled: { start: "running" },
  proof_ready: { proof_complete: "complete" },
  complete: {},
};

export function transitionCreationSession(
  state: CreationSessionState,
  action: CreationLifecycleAction,
): CreationSessionState {
  const next = lifecycleTransitions[state][action];
  if (!next) {
    throw new CreationCoreError(
      "CREATION_STATE_INVALID",
      `Creation session cannot ${action} while ${state}.`,
    );
  }
  return next;
}

export { ComfyUiProviderAdapter } from "./provider/comfyui";
