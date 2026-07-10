//! Public v0.2 protocol types, strict JSON parsing, and shared validation.

mod model;
mod schema;
mod strict_json;
mod validation;

pub use model::*;
pub use schema::{
    validate_event_schema, validate_manifest_schema, validate_verification_result_schema,
    validate_workspace_schema,
};
pub use strict_json::parse_json_strict;
pub use validation::{
    format_canonical_utc, normalize_rfc3339, parse_canonical_rfc3339, validate_asset_role,
    validate_canonical_timestamp, validate_event_type, validate_package_path, validate_sha256_hex,
};

pub const SCHEMA_VERSION: &str = "0.2.0";
pub const WORKSPACE_VERSION: &str = "0.2.0";
pub const HASH_ALGORITHM: &str = "sha-256";
pub const CANONICALIZATION: &str = "rfc8785-jcs";
pub const MANIFEST_PATH: &str = "manifest.json";
pub const EVENTS_PATH: &str = "events.json";
pub const WORKSPACE_FILE: &str = "proof-workspace.json";
