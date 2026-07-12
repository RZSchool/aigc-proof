import { z } from "zod";

const localPath = z
  .string()
  .trim()
  .min(1)
  .max(32_767)
  .refine((value) => !value.includes("\0"));
const assetRole = z.enum(["input", "output", "reference", "license", "other"]);

const windowsDeviceName =
  /^(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
export const workspaceFolderName = z
  .string()
  .min(1, "新工作区文件夹名不能为空。")
  .max(120, "新工作区文件夹名不能超过 120 个字符。")
  .refine((value) => value === value.trim(), "文件夹名首尾不能包含空格。")
  .refine(
    (value) => value !== "." && value !== "..",
    "文件夹名不能是 . 或 ..。",
  )
  .refine(
    (value) =>
      !Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 0x1f || '<>:"/\\|?*'.includes(character),
      ),
    "文件夹名包含路径分隔符、控制字符或跨平台禁用字符。",
  )
  .refine((value) => !value.endsWith("."), "文件夹名不能以点结尾。")
  .refine(
    (value) => !windowsDeviceName.test(value),
    "文件夹名不能使用 Windows 保留设备名。",
  );

export const workspaceTargetRequest = z
  .object({ parent: localPath, folderName: workspaceFolderName })
  .strict();

export const initializeWorkspaceRequest = z
  .object({
    parent: localPath,
    folderName: workspaceFolderName,
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
