import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const selectedPath = z.string().min(1).max(32_767).refine(path.isAbsolute);
const qaSelectionsSchema = z
  .object({
    workspaceParents: z.array(selectedPath),
    existingWorkspaces: z.array(selectedPath),
    assets: z.array(selectedPath),
    images: z.array(selectedPath).default([]),
    imageOutputs: z.array(selectedPath).default([]),
    packages: z.array(selectedPath),
    packageOutputs: z.array(selectedPath),
    reportOutputs: z.array(selectedPath),
    providerInstallations: z.array(selectedPath).default([]),
  })
  .strict();

export type QaSelectionKind = keyof z.infer<typeof qaSelectionsSchema>;

export class QaSelectionProvider {
  constructor(private readonly queues: z.infer<typeof qaSelectionsSchema>) {}

  take(kind: QaSelectionKind): string {
    const selected = this.queues[kind].shift();
    if (!selected) throw new Error(`QA_SELECTION_MISSING: ${kind}`);
    return selected;
  }
}

export async function loadQaSelectionProvider(
  argv: string[],
  qaEnabled: boolean,
): Promise<QaSelectionProvider | undefined> {
  const prefix = "--qa-selection-manifest=";
  const argument = argv.find((value) => value.startsWith(prefix));
  if (!argument) return undefined;
  if (!qaEnabled) {
    throw new Error(
      "QA_SELECTIONS_DISABLED: selection manifests require the explicit QA debugging flag.",
    );
  }
  const manifestPath = argument.slice(prefix.length);
  if (!path.isAbsolute(manifestPath)) {
    throw new Error("QA_SELECTIONS_INVALID: manifest path must be absolute.");
  }
  const raw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown;
  return new QaSelectionProvider(qaSelectionsSchema.parse(raw));
}
