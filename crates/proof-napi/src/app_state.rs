use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use proof_core::{VerificationLimits, inspect_package, load_workspace};
use rusqlite::{Connection, params};
use serde::Serialize;

#[cfg(test)]
use rusqlite::OptionalExtension;

use crate::BridgeFailure;

const SCHEMA_VERSION: i64 = 1;
const PREFERENCE_KEYS: &[&str] = &["language", "theme", "lastSection", "windowState"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub path: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchState {
    pub schema_version: i64,
    pub preferences: BTreeMap<String, String>,
    pub recent_workspaces: Vec<RecentItem>,
    pub recent_packages: Vec<RecentItem>,
}

pub fn initialize(database: &Path) -> Result<WorkbenchState, BridgeFailure> {
    let connection = open(database)?;
    migrate(&connection)?;
    read_state(&connection)
}

pub fn set_preference(
    database: &Path,
    key: &str,
    value: &str,
) -> Result<WorkbenchState, BridgeFailure> {
    if !PREFERENCE_KEYS.contains(&key) {
        return Err(BridgeFailure::input(
            "PREFERENCE_KEY_NOT_ALLOWED",
            "Preference key is not allowlisted.",
        ));
    }
    if value.len() > 2_000 {
        return Err(BridgeFailure::input(
            "PREFERENCE_VALUE_TOO_LONG",
            "Preference value exceeds 2000 bytes.",
        ));
    }
    let connection = open(database)?;
    migrate(&connection)?;
    connection
        .execute(
            "INSERT INTO preferences(key, value) VALUES(?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(BridgeFailure::database)?;
    read_state(&connection)
}

pub fn remember_recent(
    database: &Path,
    kind: &str,
    path: &Path,
    timestamp: &str,
) -> Result<WorkbenchState, BridgeFailure> {
    validate_kind(kind)?;
    let connection = open(database)?;
    migrate(&connection)?;
    connection
        .execute(
            "INSERT INTO recent_items(kind, path, last_opened_at) VALUES(?1, ?2, ?3) \
             ON CONFLICT(kind, path) DO UPDATE SET last_opened_at = excluded.last_opened_at",
            params![kind, path.to_string_lossy(), timestamp],
        )
        .map_err(BridgeFailure::database)?;
    connection
        .execute(
            "DELETE FROM recent_items WHERE rowid IN (\
               SELECT rowid FROM recent_items WHERE kind = ?1 \
               ORDER BY last_opened_at DESC, rowid DESC LIMIT -1 OFFSET 20\
             )",
            params![kind],
        )
        .map_err(BridgeFailure::database)?;
    read_state(&connection)
}

pub fn rebuild_recents(database: &Path) -> Result<WorkbenchState, BridgeFailure> {
    let connection = open(database)?;
    migrate(&connection)?;
    let mut statement = connection
        .prepare("SELECT kind, path FROM recent_items")
        .map_err(BridgeFailure::database)?;
    let candidates = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(BridgeFailure::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(BridgeFailure::database)?;
    drop(statement);
    for (kind, value) in candidates {
        let path = PathBuf::from(&value);
        let valid = match kind.as_str() {
            "workspace" => load_workspace(&path).is_ok(),
            "package" => inspect_package(&path, &VerificationLimits::default()).is_ok(),
            _ => false,
        };
        if !valid {
            connection
                .execute(
                    "DELETE FROM recent_items WHERE kind = ?1 AND path = ?2",
                    params![kind, value],
                )
                .map_err(BridgeFailure::database)?;
        }
    }
    read_state(&connection)
}

fn open(database: &Path) -> Result<Connection, BridgeFailure> {
    if let Some(parent) = database.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            BridgeFailure::new(
                "APP_STATE_DIRECTORY_FAILED",
                error.to_string(),
                Some(parent.to_path_buf()),
            )
        })?;
    }
    let connection = Connection::open(database).map_err(BridgeFailure::database)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(BridgeFailure::database)?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(BridgeFailure::database)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), BridgeFailure> {
    let version = connection
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map_err(BridgeFailure::database)?;
    if version > SCHEMA_VERSION {
        return Err(BridgeFailure::input(
            "APP_STATE_VERSION_UNSUPPORTED",
            "Application state database is newer than this workbench.",
        ));
    }
    if version == 0 {
        connection
            .execute_batch(
                "BEGIN;
                 CREATE TABLE preferences(
                   key TEXT PRIMARY KEY NOT NULL,
                   value TEXT NOT NULL
                 );
                 CREATE TABLE recent_items(
                   kind TEXT NOT NULL CHECK(kind IN ('workspace', 'package')),
                   path TEXT NOT NULL,
                   last_opened_at TEXT NOT NULL,
                   PRIMARY KEY(kind, path)
                 );
                 PRAGMA user_version = 1;
                 COMMIT;",
            )
            .map_err(BridgeFailure::database)?;
    }
    Ok(())
}

fn read_state(connection: &Connection) -> Result<WorkbenchState, BridgeFailure> {
    let mut preferences = BTreeMap::new();
    let mut preference_statement = connection
        .prepare("SELECT key, value FROM preferences ORDER BY key")
        .map_err(BridgeFailure::database)?;
    for row in preference_statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(BridgeFailure::database)?
    {
        let (key, value) = row.map_err(BridgeFailure::database)?;
        preferences.insert(key, value);
    }
    Ok(WorkbenchState {
        schema_version: connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(BridgeFailure::database)?,
        preferences,
        recent_workspaces: read_recents(connection, "workspace")?,
        recent_packages: read_recents(connection, "package")?,
    })
}

fn read_recents(connection: &Connection, kind: &str) -> Result<Vec<RecentItem>, BridgeFailure> {
    let mut statement = connection
        .prepare(
            "SELECT path, last_opened_at FROM recent_items \
             WHERE kind = ?1 ORDER BY last_opened_at DESC, rowid DESC LIMIT 20",
        )
        .map_err(BridgeFailure::database)?;
    statement
        .query_map(params![kind], |row| {
            Ok(RecentItem {
                path: row.get(0)?,
                last_opened_at: row.get(1)?,
            })
        })
        .map_err(BridgeFailure::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(BridgeFailure::database)
}

fn validate_kind(kind: &str) -> Result<(), BridgeFailure> {
    if matches!(kind, "workspace" | "package") {
        Ok(())
    } else {
        Err(BridgeFailure::input(
            "RECENT_KIND_NOT_ALLOWED",
            "Recent item kind must be workspace or package.",
        ))
    }
}

#[cfg(test)]
pub fn contains_recent(database: &Path, kind: &str, path: &Path) -> Result<bool, BridgeFailure> {
    let connection = open(database)?;
    migrate(&connection)?;
    connection
        .query_row(
            "SELECT 1 FROM recent_items WHERE kind = ?1 AND path = ?2",
            params![kind, path.to_string_lossy()],
            |_| Ok(true),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(BridgeFailure::database)
}
