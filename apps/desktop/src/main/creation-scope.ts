import { randomUUID } from "node:crypto";

import {
  HostContractError,
  creationSessionReferenceSchema,
  hostReferenceSchema,
  type CreationSessionReference,
} from "@aigc-proof/host-contracts";

interface ActiveWorkspaceScope {
  workspacePath: string;
  generation: number;
}

interface CreationSessionAuthority {
  owner: number;
  sessionId: string;
  workspacePath: string;
  generation: number;
  expiresAt: number;
  reference: CreationSessionReference;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class CreationSessionScopeRegistry {
  readonly #activeScopes = new Map<number, ActiveWorkspaceScope>();
  readonly #authorities = new Map<string, CreationSessionAuthority>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly defaultTtlMs = DEFAULT_TTL_MS,
  ) {}

  activate(owner: number, workspacePath: string): void {
    const previous = this.#activeScopes.get(owner);
    if (previous?.workspacePath === workspacePath) return;
    this.#activeScopes.set(owner, {
      workspacePath,
      generation: (previous?.generation ?? 0) + 1,
    });
  }

  assertActive(owner: number, workspacePath: string): void {
    const active = this.#activeScopes.get(owner);
    if (!active || active.workspacePath !== workspacePath) {
      throw new HostContractError(
        "CREATION_RELATIONSHIP_INVALID",
        "Creation session operation does not belong to the active workspace scope.",
      );
    }
  }

  isActive(owner: number, workspacePath: string): boolean {
    return this.#activeScopes.get(owner)?.workspacePath === workspacePath;
  }

  issue(
    owner: number,
    sessionId: string,
    workspacePath: string,
    displayLabel: string,
  ): CreationSessionReference {
    this.assertActive(owner, workspacePath);
    const active = this.#activeScopes.get(owner)!;
    const existing = [...this.#authorities.values()].find(
      (authority) =>
        authority.owner === owner &&
        authority.sessionId === sessionId &&
        authority.generation === active.generation &&
        authority.expiresAt > this.now(),
    );
    if (existing) return existing.reference;

    const reference = Object.freeze({
      id: `ref_${randomUUID().replaceAll("-", "")}`,
      kind: "creation-session",
      displayLabel,
    }) as CreationSessionReference;
    this.#authorities.set(reference.id, {
      owner,
      sessionId,
      workspacePath,
      generation: active.generation,
      expiresAt: this.now() + this.defaultTtlMs,
      reference,
    });
    return reference;
  }

  resolve(
    owner: number,
    raw: unknown,
  ): { sessionId: string; workspacePath: string } {
    const parsed = creationSessionReferenceSchema.safeParse(raw);
    if (!parsed.success) {
      const generic = hostReferenceSchema.safeParse(raw);
      throw new HostContractError(
        generic.success && generic.data.kind !== "creation-session"
          ? "HOST_REFERENCE_KIND_MISMATCH"
          : "HOST_REFERENCE_INVALID",
        "Creation session reference is malformed or has the wrong kind.",
      );
    }
    const authority = this.#authorities.get(parsed.data.id);
    if (!authority) {
      throw new HostContractError(
        "HOST_REFERENCE_UNKNOWN",
        "Creation session reference is unknown to this application session.",
      );
    }
    if (authority.owner !== owner) {
      throw new HostContractError(
        "HOST_REFERENCE_ORIGIN_MISMATCH",
        "Creation session reference belongs to another renderer origin.",
      );
    }
    if (
      parsed.data.displayLabel !== authority.reference.displayLabel ||
      parsed.data.displayPath !== authority.reference.displayPath
    ) {
      throw new HostContractError(
        "HOST_REFERENCE_INVALID",
        "Creation session display fields were substituted after issuance.",
      );
    }
    if (authority.expiresAt <= this.now()) {
      this.#authorities.delete(parsed.data.id);
      throw new HostContractError(
        "HOST_REFERENCE_EXPIRED",
        "Creation session reference expired; restore it from the active workspace again.",
      );
    }
    const active = this.#activeScopes.get(owner);
    if (
      !active ||
      active.generation !== authority.generation ||
      active.workspacePath !== authority.workspacePath
    ) {
      throw new HostContractError(
        "HOST_REFERENCE_EXPIRED",
        "Creation session reference belongs to an inactive workspace scope.",
      );
    }
    return {
      sessionId: authority.sessionId,
      workspacePath: authority.workspacePath,
    };
  }
}
