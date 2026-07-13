import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkbenchStateStore } from "./app-state";

let root = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "proof-state-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("Main-owned disposable SQLite state", () => {
  it("persists preferences and publishes only Rust-validated recents", () => {
    const store = new WorkbenchStateStore(path.join(root, "workbench.sqlite3"));
    store.setPreference("theme", "dark");
    store.remember("workspace", path.join(root, "workspace"));
    store.remember("package", path.join(root, "proof.aigcproof"));
    expect(store.read().recentWorkspaces).toHaveLength(1);
    const rebuilt = store.publishValidated([
      { kind: "package", path: path.join(root, "proof.aigcproof") },
    ]);
    expect(rebuilt.preferences.theme).toBe("dark");
    expect(rebuilt.recentWorkspaces).toHaveLength(0);
    expect(rebuilt.recentPackages).toHaveLength(1);
    store.close();
  });

  it("recovers a corrupt disposable database without touching portable evidence", async () => {
    const database = path.join(root, "workbench.sqlite3");
    await fs.writeFile(database, "not sqlite", "utf8");
    const store = new WorkbenchStateStore(database);
    expect(store.read()).toMatchObject({ schemaVersion: 1, preferences: {} });
    store.close();
    const names = await fs.readdir(root);
    expect(
      names.some((name) => name.startsWith("workbench.sqlite3.corrupt-")),
    ).toBe(true);
  });
});
