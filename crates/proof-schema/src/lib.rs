//! Public v0.2-v0.5 protocol types, strict JSON parsing, and shared validation.

mod model;
mod schema;
mod strict_json;
mod validation;

pub use model::*;
pub use schema::{
    validate_c2pa_profile_schema, validate_event_schema, validate_manifest_schema,
    validate_tsa_profile_schema, validate_verification_result_schema, validate_workspace_schema,
};
pub use strict_json::parse_json_strict;
pub use validation::{
    display_label_needs_confusable_warning, format_canonical_utc, normalize_rfc3339,
    parse_canonical_rfc3339, validate_asset_role, validate_canonical_timestamp,
    validate_display_label, validate_event_type, validate_media_type, validate_package_path,
    validate_portable_basename, validate_proof_id, validate_sha256_hex, validate_uuid,
};

pub const LEGACY_SCHEMA_VERSION: &str = "0.2.0";
pub const SIGNED_SCHEMA_VERSION: &str = "0.3.0";
pub const TRUSTED_SCHEMA_VERSION: &str = "0.4.0";
pub const SCHEMA_VERSION: &str = "0.5.0";
pub const LEGACY_WORKSPACE_VERSION: &str = "0.2.0";
pub const SIGNED_WORKSPACE_VERSION: &str = "0.3.0";
pub const TRUSTED_WORKSPACE_VERSION: &str = "0.4.0";
pub const WORKSPACE_VERSION: &str = "0.5.0";
pub const HASH_ALGORITHM: &str = "sha-256";
pub const CANONICALIZATION: &str = "rfc8785-jcs";
pub const MANIFEST_PATH: &str = "manifest.json";
pub const EVENTS_PATH: &str = "events.json";
pub const WORKSPACE_FILE: &str = "proof-workspace.json";
pub const CREATOR_SIGNATURE_PROFILE_V03: &str = "aigc-proof.creator-signature.cose-ed25519.v1";
pub const CREATOR_SIGNATURE_PROFILE_V04: &str = "aigc-proof.creator-signature.cose-ed25519.v2";
pub const CREATOR_SIGNATURE_PROFILE: &str = "aigc-proof.creator-signature.cose-ed25519.v3";
pub const CREATOR_SIGNATURE_PATH: &str = "security/signatures/creator.cose";
pub const CREATOR_KEY_PREFIX: &str = "security/keys/";
pub const TRUSTED_TIMESTAMP_PROFILE: &str = "aigc-proof.trusted-time.rfc3161.v1";
pub const TSA_TRUST_PROFILE: &str = "aigc-proof.tsa-trust-profile.v1";
pub const TRUSTED_TIMESTAMP_PREFIX: &str = "security/timestamps/";
pub const C2PA_BRIDGE_PROFILE: &str = "aigc-proof.c2pa-observation.v1";
pub const C2PA_TRUST_PROFILE: &str = "aigc-proof.c2pa-trust-profile.v1";
pub const C2PA_OBSERVATION_EVENT: &str = "c2pa_observation";
