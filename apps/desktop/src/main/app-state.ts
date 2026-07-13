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

const SCHEMA_VERSION = 1;

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
            "PRAGMA user_version = 1; COMMIT;",
        );
      }
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }
}
