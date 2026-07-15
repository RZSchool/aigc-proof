import { describe, expect, it } from "vitest";

import { CreationSessionScopeRegistry } from "./creation-scope";

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("workspace-scoped creation-session authority", () => {
  it("rejects forged, wrong-kind, wrong-origin, substituted and expired references", () => {
    let now = 1_000;
    const scopes = new CreationSessionScopeRegistry(() => now, 50);
    scopes.activate(7, "C:\\workspace-a");
    const session = scopes.issue(
      7,
      "session-a",
      "C:\\workspace-a",
      "Session A",
    );

    expect(scopes.resolve(7, session)).toEqual({
      sessionId: "session-a",
      workspacePath: "C:\\workspace-a",
    });
    expectCode(
      () => scopes.resolve(7, { ...session, id: `ref_${"f".repeat(32)}` }),
      "HOST_REFERENCE_UNKNOWN",
    );
    expectCode(
      () => scopes.resolve(7, { ...session, kind: "workspace" }),
      "HOST_REFERENCE_KIND_MISMATCH",
    );
    expectCode(
      () => scopes.resolve(8, session),
      "HOST_REFERENCE_ORIGIN_MISMATCH",
    );
    expectCode(
      () => scopes.resolve(7, { ...session, displayLabel: "forged" }),
      "HOST_REFERENCE_INVALID",
    );

    now += 51;
    expectCode(() => scopes.resolve(7, session), "HOST_REFERENCE_EXPIRED");
  });

  it("invalidates the prior workspace generation and refuses cross-workspace selection", () => {
    const scopes = new CreationSessionScopeRegistry();
    scopes.activate(7, "C:\\workspace-a");
    const sessionA = scopes.issue(
      7,
      "session-a",
      "C:\\workspace-a",
      "Session A",
    );

    scopes.activate(7, "C:\\workspace-b");
    expectCode(() => scopes.resolve(7, sessionA), "HOST_REFERENCE_EXPIRED");
    expectCode(
      () => scopes.assertActive(7, "C:\\workspace-a"),
      "CREATION_RELATIONSHIP_INVALID",
    );
    const sessionB = scopes.issue(
      7,
      "session-b",
      "C:\\workspace-b",
      "Session B",
    );
    expect(scopes.resolve(7, sessionB).workspacePath).toBe("C:\\workspace-b");
  });
});
