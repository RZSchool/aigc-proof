import { z } from "zod";

const localPath = z
  .string()
  .trim()
  .min(1)
  .max(32_767)
  .refine((value) => !value.includes("\0"));
const assetRole = z.enum(["input", "output", "reference", "license", "other"]);

export const initializeWorkspaceRequest = z
  .object({
    path: localPath,
    projectName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const pathRequest = z.object({ path: localPath }).strict();
export const addAssetRequest = z
  .object({ workspace: localPath, source: localPath, role: assetRole })
  .strict();
export const recordEventRequest = z
  .object({
    workspace: localPath,
    eventType: z.string().trim().min(1).max(100),
    payloadJson: z
      .string()
      .min(2)
      .max(16 * 1024 * 1024),
  })
  .strict();
export const sealPackageRequest = z
  .object({ workspace: localPath, output: localPath })
  .strict();
export const setPreferenceRequest = z
  .object({
    key: z.enum(["language", "theme", "lastSection", "windowState"]),
    value: z.string().max(2_000),
  })
  .strict();

const verificationIssue = z
  .object({
    code: z.string(),
    path: z.string().optional(),
    message: z.string(),
  })
  .strict();
export const verificationReportSchema = z
  .object({
    spec_version: z.literal("0.2.0"),
    proof_id: z.string().nullable(),
    verified_at: z.string(),
    status: z.enum(["valid", "invalid", "error"]),
    assurance: z
      .object({
        internal_integrity: z.enum(["valid", "invalid", "not_evaluated"]),
        creator_identity: z.literal("not_verified"),
        digital_signature: z.literal("not_present"),
        trusted_time: z.literal("not_present"),
        originality: z.literal("not_evaluated"),
      })
      .strict(),
    checks: z.array(
      verificationIssue
        .extend({ status: z.enum(["pass", "fail", "skipped"]) })
        .strict(),
    ),
    errors: z.array(verificationIssue),
    warnings: z.array(
      z.object({ code: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
export const saveReportRequest = z
  .object({ path: localPath, report: verificationReportSchema })
  .strict();

export const bridgeEnvelopeSchema = z.union([
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
