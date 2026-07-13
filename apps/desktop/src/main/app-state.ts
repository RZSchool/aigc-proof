import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface StoredRecentItem {
  kind: "workspace" | "package";
  path: string;
  lastOpenedAt: string;
}

export interface StoredWorkbenchState {
  schemaVersion: number;
  preferences: Record<string, string>;
  recentWorkspaces: StoredRecentItem[];
  recentPackages: StoredRecentItem[];
}

export interface StoredProviderInstallation {
  path: string;
  detectedVersion: string;
  licenseSha256: string;
  checkpoints: string[];
  customNodeCount: number;
  lastInspectedAt: string;
}

export interface StoredCreationSession {
  id: string;
  title: string;
  state:
    | "draft"
    | "frozen"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "proof_ready"
    | "complete";
  workspacePath: string;
  providerPath: string;
  providerVersion: string;
  createdAt: string;
  updatedAt: string;
  snapshotJson?: string | undefined;
  providerJobId?: string | undefined;
  progressJson?: string | undefined;
  outputJson?: string | undefined;
  packagePath?: string | undefined;
  reportPath?: string | undefined;
  verificationJson?: string | undefined;
  errorJson?: string | undefined;
}

const SCHEMA_VERSION = 2;

export class WorkbenchStateStore {
  #database: DatabaseSync;

  constructor(private readonly databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = this.#openWithRecovery();
  }

  read(): StoredWorkbenchState {
    const preferences: Record<string, string> = {};
    for (const raw of this.#database
      .prepare("SELECT key, value FROM preferences ORDER BY key")
      .all()) {
      const row = raw as { key: string; value: string };
      preferences[row.key] = row.value;
    }
    const recents = (kind: "workspace" | "package") =>
      this.#database
        .prepare(
          "SELECT kind, path, last_opened_at AS lastOpenedAt FROM recent_items " +
            "WHERE kind = ? ORDER BY last_opened_at DESC, rowid DESC LIMIT 20",
        )
        .all(kind) as StoredRecentItem[];
    return {
      schemaVersion: SCHEMA_VERSION,
      preferences,
      recentWorkspaces: recents("workspace"),
      recentPackages: recents("package"),
    };
  }

  setPreference(key: string, value: string): StoredWorkbenchState {
    this.#database
      .prepare(
        "INSERT INTO preferences(key, value) VALUES(?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
    return this.read();
  }

  rememberProvider(
    provider: StoredProviderInstallation,
  ): StoredProviderInstallation {
    this.#database
      .prepare(
        "INSERT INTO provider_installations(" +
          "path, detected_version, license_sha256, checkpoints_json, custom_node_count, last_inspected_at" +
          ") VALUES(?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(path) DO UPDATE SET " +
          "detected_version = excluded.detected_version, " +
          "license_sha256 = excluded.license_sha256, " +
          "checkpoints_json = excluded.checkpoints_json, " +
          "custom_node_count = excluded.custom_node_count, " +
          "last_inspected_at = excluded.last_inspected_at",
      )
      .run(
        provider.path,
        provider.detectedVersion,
        provider.licenseSha256,
        JSON.stringify(provider.checkpoints),
        provider.customNodeCount,
        provider.lastInspectedAt,
      );
    return provider;
  }

  providers(): StoredProviderInstallation[] {
    return this.#database
      .prepare(
        "SELECT path, detected_version AS detectedVersion, " +
          "license_sha256 AS licenseSha256, checkpoints_json AS checkpointsJson, " +
          "custom_node_count AS customNodeCount, last_inspected_at AS lastInspectedAt " +
          "FROM provider_installations ORDER BY last_inspected_at DESC",
      )
      .all()
      .map((raw) => {
        const row = raw as Omit<StoredProviderInstallation, "checkpoints"> & {
          checkpointsJson: string;
        };
        return {
          path: row.path,
          detectedVersion: row.detectedVersion,
          licenseSha256: row.licenseSha256,
          checkpoints: JSON.parse(row.checkpointsJson) as string[],
          customNodeCount: row.customNodeCount,
          lastInspectedAt: row.lastInspectedAt,
        };
      });
  }

  createSession(session: StoredCreationSession): StoredCreationSession {
    this.#database
      .prepare(
        "INSERT INTO creation_sessions(" +
          "id, title, state, workspace_path, provider_path, provider_version, created_at, updated_at" +
          ") VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        session.id,
        session.title,
        session.state,
        session.workspacePath,
        session.providerPath,
        session.providerVersion,
        session.createdAt,
        session.updatedAt,
      );
    return this.session(session.id)!;
  }

  session(id: string): StoredCreationSession | undefined {
    const raw = this.#database
      .prepare(
        "SELECT id, title, state, workspace_path AS workspacePath, " +
          "provider_path AS providerPath, provider_version AS providerVersion, " +
          "created_at AS createdAt, updated_at AS updatedAt, snapshot_json AS snapshotJson, " +
          "provider_job_id AS providerJobId, progress_json AS progressJson, " +
          "output_json AS outputJson, package_path AS packagePath, report_path AS reportPath, " +
          "verification_json AS verificationJson, error_json AS errorJson " +
          "FROM creation_sessions WHERE id = ?",
      )
      .get(id);
    return raw ? this.#storedSession(raw) : undefined;
  }

  sessions(): StoredCreationSession[] {
    return this.#database
      .prepare(
        "SELECT id, title, state, workspace_path AS workspacePath, " +
          "provider_path AS providerPath, provider_version AS providerVersion, " +
          "created_at AS createdAt, updated_at AS updatedAt, snapshot_json AS snapshotJson, " +
          "provider_job_id AS providerJobId, progress_json AS progressJson, " +
          "output_json AS outputJson, package_path AS packagePath, report_path AS reportPath, " +
          "verification_json AS verificationJson, error_json AS errorJson " +
          "FROM creation_sessions ORDER BY updated_at DESC, rowid DESC LIMIT 100",
      )
      .all()
      .map((row) => this.#storedSession(row));
  }

  recoverInterruptedCreationSessions(): number {
    const updatedAt = new Date().toISOString();
    const errorJson = JSON.stringify({
      code: "PROVIDER_PROCESS_LOST",
      kind: "provider",
      message:
        "Creation was interrupted before proof evidence completed; review the frozen snapshot before retrying.",
    });
    const progressJson = JSON.stringify({
      completedUnits: 0,
      totalUnits: 100,
      message: "上次创作在证据完成前中断，已安全标记为失败。",
    });
    const result = this.#database
      .prepare(
        "UPDATE creation_sessions SET state = 'failed', error_json = ?, progress_json = ?, updated_at = ? " +
          "WHERE state IN ('running', 'succeeded')",
      )
      .run(errorJson, progressJson, updatedAt);
    return Number(result.changes);
  }

  updateSession(
    id: string,
    patch: Partial<
      Pick<
        StoredCreationSession,
        | "state"
        | "snapshotJson"
        | "providerJobId"
        | "progressJson"
        | "outputJson"
        | "packagePath"
        | "reportPath"
        | "verificationJson"
        | "errorJson"
      >
    >,
  ): StoredCreationSession {
    const columns: Record<string, string> = {
      state: "state",
      snapshotJson: "snapshot_json",
      providerJobId: "provider_job_id",
      progressJson: "progress_json",
      outputJson: "output_json",
      packagePath: "package_path",
      reportPath: "report_path",
      verificationJson: "verification_json",
      errorJson: "error_json",
    };
    const entries = Object.entries(patch).filter(([key]) => key in columns);
    if (entries.length === 0) {
      const existing = this.session(id);
      if (!existing) throw new Error("CREATION_SESSION_NOT_FOUND");
      return existing;
    }
    const updatedAt = new Date().toISOString();
    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    const result = this.#database
      .prepare(
        `UPDATE creation_sessions SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`,
      )
      .run(...entries.map(([, value]) => value ?? null), updatedAt, id);
    if (result.changes !== 1) throw new Error("CREATION_SESSION_NOT_FOUND");
    return this.session(id)!;
  }

  remember(
    kind: "workspace" | "package",
    selectedPath: string,
  ): StoredWorkbenchState {
    this.#database
      .prepare(
        "INSERT INTO recent_items(kind, path, last_opened_at) VALUES(?, ?, ?) " +
          "ON CONFLICT(kind, path) DO UPDATE SET last_opened_at = excluded.last_opened_at",
      )
      .run(kind, selectedPath, new Date().toISOString());
    this.#database
      .prepare(
        "DELETE FROM recent_items WHERE rowid IN (" +
          "SELECT rowid FROM recent_items WHERE kind = ? " +
          "ORDER BY last_opened_at DESC, rowid DESC LIMIT -1 OFFSET 20)",
      )
      .run(kind);
    return this.read();
  }

  candidates(): StoredRecentItem[] {
    const state = this.read();
    return [...state.recentWorkspaces, ...state.recentPackages];
  }

  publishValidated(
    valid: Array<{ kind: "workspace" | "package"; path: string }>,
  ): StoredWorkbenchState {
    const keys = new Set(valid.map((item) => `${item.kind}\0${item.path}`));
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const item of this.candidates()) {
        if (!keys.has(`${item.kind}\0${item.path}`)) {
          this.#database
            .prepare("DELETE FROM recent_items WHERE kind = ? AND path = ?")
            .run(item.kind, item.path);
        }
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return this.read();
  }

  close(): void {
    this.#database.close();
  }

  #storedSession(raw: unknown): StoredCreationSession {
    const row = raw as Record<string, unknown>;
    const optional = (key: string) =>
      typeof row[key] === "string" ? (row[key] as string) : undefined;
    return {
      id: String(row.id),
      title: String(row.title),
      state: row.state as StoredCreationSession["state"],
      workspacePath: String(row.workspacePath),
      providerPath: String(row.providerPath),
      providerVersion: String(row.providerVersion),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      ...(optional("snapshotJson")
        ? { snapshotJson: optional("snapshotJson") }
        : {}),
      ...(optional("providerJobId")
        ? { providerJobId: optional("providerJobId") }
        : {}),
      ...(optional("progressJson")
        ? { progressJson: optional("progressJson") }
        : {}),
      ...(optional("outputJson") ? { outputJson: optional("outputJson") } : {}),
      ...(optional("packagePath")
        ? { packagePath: optional("packagePath") }
        : {}),
      ...(optional("reportPath") ? { reportPath: optional("reportPath") } : {}),
      ...(optional("verificationJson")
        ? { verificationJson: optional("verificationJson") }
        : {}),
      ...(optional("errorJson") ? { errorJson: optional("errorJson") } : {}),
    };
  }

  #openWithRecovery(): DatabaseSync {
    try {
      return this.#open();
    } catch (error) {
      const suffix = `.corrupt-${Date.now()}`;
      for (const candidate of [
        this.databasePath,
        `${this.databasePath}-wal`,
        `${this.databasePath}-shm`,
      ]) {
        if (fs.existsSync(candidate))
          fs.renameSync(candidate, `${candidate}${suffix}`);
      }
      try {
        return this.#open();
      } catch {
        throw error;
      }
    }
  }

  #open(): DatabaseSync {
    const database = new DatabaseSync(this.databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
      const rawVersion = database.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (rawVersion.user_version > SCHEMA_VERSION) {
        throw new Error("APP_STATE_VERSION_UNSUPPORTED");
      }
      if (rawVersion.user_version === 0) {
        database.exec(
          "BEGIN;" +
            "CREATE TABLE preferences(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);" +
            "CREATE TABLE recent_items(" +
            "kind TEXT NOT NULL CHECK(kind IN ('workspace', 'package'))," +
            "path TEXT NOT NULL, last_opened_at TEXT NOT NULL, PRIMARY KEY(kind, path));" +
            "CREATE TABLE provider_installations(" +
            "path TEXT PRIMARY KEY NOT NULL, detected_version TEXT NOT NULL, " +
            "license_sha256 TEXT NOT NULL, checkpoints_json TEXT NOT NULL, " +
            "custom_node_count INTEGER NOT NULL, last_inspected_at TEXT NOT NULL);" +
            "CREATE TABLE creation_sessions(" +
            "id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, " +
            "state TEXT NOT NULL CHECK(state IN ('draft','frozen','running','succeeded','failed','cancelled','proof_ready','complete')), " +
            "workspace_path TEXT NOT NULL, provider_path TEXT NOT NULL, provider_version TEXT NOT NULL, " +
            "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, snapshot_json TEXT, " +
            "provider_job_id TEXT, progress_json TEXT, output_json TEXT, package_path TEXT, " +
            "report_path TEXT, verification_json TEXT, error_json TEXT);" +
            "PRAGMA user_version = 2; COMMIT;",
        );
      }
      if (rawVersion.user_version === 1) {
        database.exec(
          "BEGIN;" +
            "CREATE TABLE provider_installations(" +
            "path TEXT PRIMARY KEY NOT NULL, detected_version TEXT NOT NULL, " +
            "license_sha256 TEXT NOT NULL, checkpoints_json TEXT NOT NULL, " +
            "custom_node_count INTEGER NOT NULL, last_inspected_at TEXT NOT NULL);" +
            "CREATE TABLE creation_sessions(" +
            "id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, " +
            "state TEXT NOT NULL CHECK(state IN ('draft','frozen','running','succeeded','failed','cancelled','proof_ready','complete')), " +
            "workspace_path TEXT NOT NULL, provider_path TEXT NOT NULL, provider_version TEXT NOT NULL, " +
            "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, snapshot_json TEXT, " +
            "provider_job_id TEXT, progress_json TEXT, output_json TEXT, package_path TEXT, " +
            "report_path TEXT, verification_json TEXT, error_json TEXT);" +
            "PRAGMA user_version = 2; COMMIT;",
        );
      }
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }
}
