import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("typed preload source", () => {
  it("exposes purpose-specific workspace methods without generic IPC or filesystem access", async () => {
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/preload/preload.ts"),
      "utf8",
    );

    expect(source).toContain("chooseWorkspaceParent");
    expect(source).toContain("chooseExistingWorkspace");
    expect(source).toContain("previewWorkspaceTarget");
    expect(source).toContain(
      'contextBridge.exposeInMainWorld("aigcProof", api)',
    );
    expect(source).not.toContain('from "node:fs');
    expect(source).not.toContain('from "node:path');
    expect(source).not.toContain("ipcRenderer.send");
    expect(source).not.toMatch(/invoke\s*:\s*\(/u);
  });
});
