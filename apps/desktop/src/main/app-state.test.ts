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
    expect(store.read()).toMatchObject({ schemaVersion: 2, preferences: {} });
    store.close();
    const names = await fs.readdir(root);
    expect(
      names.some((name) => name.startsWith("workbench.sqlite3.corrupt-")),
    ).toBe(true);
  });

  it("persists provider inventory and restart-safe creation session state in schema v2", () => {
    const database = path.join(root, "workbench.sqlite3");
    const store = new WorkbenchStateStore(database);
    store.rememberProvider({
      path: path.join(root, "ComfyUI"),
      detectedVersion: "0.27.0",
      licenseSha256: "a".repeat(64),
      checkpoints: ["model.safetensors"],
      customNodeCount: 0,
      lastInspectedAt: "2026-07-14T00:00:00Z",
    });
    store.createSession({
      id: "session_abcdefghijkl",
      title: "creation",
      state: "draft",
      workspacePath: path.join(root, "workspace"),
      providerPath: path.join(root, "ComfyUI"),
      providerVersion: "0.27.0",
      createdAt: "2026-07-14T00:00:00Z",
      updatedAt: "2026-07-14T00:00:00Z",
    });
    store.updateSession("session_abcdefghijkl", {
      state: "frozen",
      snapshotJson: '{"snapshot_version":"1.0.0"}',
    });
    store.close();

    const reopened = new WorkbenchStateStore(database);
    expect(reopened.read().schemaVersion).toBe(2);
    expect(reopened.providers()[0]).toMatchObject({
      detectedVersion: "0.27.0",
      checkpoints: ["model.safetensors"],
    });
    expect(reopened.session("session_abcdefghijkl")).toMatchObject({
      state: "frozen",
      snapshotJson: '{"snapshot_version":"1.0.0"}',
    });
    reopened.close();
  });

  it("recovers interrupted provider-success states as retryable failures", () => {
    const database = path.join(root, "interrupted.sqlite3");
    const store = new WorkbenchStateStore(database);
    store.createSession({
      id: "session_interrupted12",
      title: "interrupted",
      state: "running",
      workspacePath: root,
      providerPath: root,
      providerVersion: "0.27.0",
      createdAt: "2026-07-14T00:00:00Z",
      updatedAt: "2026-07-14T00:00:00Z",
    });
    store.createSession({
      id: "session_succeeded123",
      title: "provider succeeded",
      state: "succeeded",
      workspacePath: root,
      providerPath: root,
      providerVersion: "0.27.0",
      createdAt: "2026-07-14T00:00:00Z",
      updatedAt: "2026-07-14T00:00:00Z",
    });
    expect(store.recoverInterruptedCreationSessions()).toBe(2);
    expect(store.session("session_interrupted12")).toMatchObject({
      state: "failed",
      errorJson: expect.stringContaining("PROVIDER_PROCESS_LOST"),
    });
    expect(store.session("session_succeeded123")?.state).toBe("failed");
    expect(store.recoverInterruptedCreationSessions()).toBe(0);
    store.close();
  });
});
