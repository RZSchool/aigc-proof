import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  HostContractError,
  type HostReference,
  type ReferenceKind,
  hostReferenceSchema,
} from "@aigc-proof/host-contracts";

interface AuthorityRecord {
  reference: HostReference;
  absolutePath: string;
  canonicalPath: string;
  owner: number;
  permissions: ReadonlySet<string>;
  oneUse: boolean;
  consumed: boolean;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

async function canonicalize(
  selectedPath: string,
  kind: ReferenceKind,
): Promise<{ absolutePath: string; canonicalPath: string }> {
  const absolutePath = path.resolve(selectedPath);
  if (kind === "package-output" || kind === "report-output") {
    const parent = path.dirname(absolutePath);
    const parentStat = await fs.stat(parent).catch(() => undefined);
    if (!parentStat?.isDirectory()) {
      throw new HostContractError(
        "HOST_REFERENCE_PATH_CHANGED",
        "The selected output parent is no longer an existing directory.",
      );
    }
    const canonicalParent = await fs.realpath(parent);
    return {
      absolutePath,
      canonicalPath: path.join(canonicalParent, path.basename(absolutePath)),
    };
  }

  const stat = await fs.stat(absolutePath).catch(() => undefined);
  const expectsDirectory = kind === "workspace-parent" || kind === "workspace";
  if (!stat || (expectsDirectory ? !stat.isDirectory() : !stat.isFile())) {
    throw new HostContractError(
      "HOST_REFERENCE_PATH_CHANGED",
      "The selected file or directory is no longer available with the expected kind.",
    );
  }
  return { absolutePath, canonicalPath: await fs.realpath(absolutePath) };
}

export class AuthorityRegistry {
  readonly #records = new Map<string, AuthorityRecord>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly defaultTtlMs = DEFAULT_TTL_MS,
  ) {}

  async issue<K extends ReferenceKind>(
    kind: K,
    selectedPath: string,
    owner: number,
    permissions: readonly string[],
    displayLabel = path.basename(selectedPath) || selectedPath,
    ttlMs = this.defaultTtlMs,
    oneUse = false,
  ): Promise<HostReference<K>> {
    const canonical = await canonicalize(selectedPath, kind);
    const reference = Object.freeze({
      id: `ref_${randomUUID().replaceAll("-", "")}`,
      kind,
      displayLabel,
      displayPath: canonical.absolutePath,
    }) as HostReference<K>;
    this.#records.set(reference.id, {
      reference,
      ...canonical,
      owner,
      permissions: new Set(permissions),
      oneUse,
      consumed: false,
      expiresAt: this.now() + ttlMs,
    });
    return reference;
  }

  async resolve(
    raw: unknown,
    expectedKind: ReferenceKind,
    owner: number,
    permission: string,
    consume = false,
  ): Promise<string> {
    const parsed = hostReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HostContractError(
        "HOST_REFERENCE_INVALID",
        "Host reference is malformed or contains an authority-bearing field.",
      );
    }
    const candidate = parsed.data;
    if (candidate.kind !== expectedKind) {
      throw new HostContractError(
        "HOST_REFERENCE_KIND_MISMATCH",
        `Expected a ${expectedKind} reference, received ${candidate.kind}.`,
      );
    }
    const record = this.#records.get(candidate.id);
    if (!record) {
      throw new HostContractError(
        "HOST_REFERENCE_UNKNOWN",
        "Host reference is unknown to this application session.",
      );
    }
    if (record.reference.kind !== expectedKind) {
      throw new HostContractError(
        "HOST_REFERENCE_KIND_MISMATCH",
        `Reference was issued for ${record.reference.kind}, not ${expectedKind}.`,
      );
    }
    if (record.owner !== owner) {
      throw new HostContractError(
        "HOST_REFERENCE_ORIGIN_MISMATCH",
        "Host reference belongs to another renderer origin.",
      );
    }
    if (!record.permissions.has(permission)) {
      throw new HostContractError(
        "HOST_REFERENCE_PERMISSION_DENIED",
        `Host reference does not grant ${permission}.`,
      );
    }
    if (
      candidate.displayLabel !== record.reference.displayLabel ||
      candidate.displayPath !== record.reference.displayPath
    ) {
      throw new HostContractError(
        "HOST_REFERENCE_INVALID",
        "Host reference display fields were substituted after issuance.",
      );
    }
    if (record.consumed) {
      throw new HostContractError(
        "HOST_REFERENCE_REUSED",
        "One-use Host reference has already been consumed.",
      );
    }
    if (record.expiresAt <= this.now()) {
      this.#records.delete(candidate.id);
      throw new HostContractError(
        "HOST_REFERENCE_EXPIRED",
        "Host reference expired; select the item again.",
      );
    }
    const current = await canonicalize(
      record.absolutePath,
      record.reference.kind,
    );
    if (current.canonicalPath !== record.canonicalPath) {
      throw new HostContractError(
        "HOST_REFERENCE_PATH_CHANGED",
        "The selected path changed after authorization; select it again.",
      );
    }
    if (consume && record.oneUse) record.consumed = true;
    return record.absolutePath;
  }

  consume(
    raw: unknown,
    expectedKind: ReferenceKind,
    owner: number,
    permission: string,
  ): void {
    const parsed = hostReferenceSchema.safeParse(raw);
    const record = parsed.success
      ? this.#records.get(parsed.data.id)
      : undefined;
    if (
      !parsed.success ||
      !record ||
      record.reference.kind !== expectedKind ||
      record.owner !== owner ||
      !record.permissions.has(permission) ||
      record.consumed
    ) {
      throw new HostContractError(
        "HOST_REFERENCE_REUSED",
        "One-use Host reference could not be consumed for this operation.",
      );
    }
    if (record.oneUse) record.consumed = true;
  }
}
