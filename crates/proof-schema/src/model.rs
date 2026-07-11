use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    HASH_ALGORITHM, SCHEMA_VERSION, WORKSPACE_VERSION, validate_asset_role,
    validate_canonical_timestamp, validate_event_type, validate_media_type, validate_package_path,
    validate_portable_basename, validate_proof_id, validate_sha256_hex, validate_uuid,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetRole {
    Input,
    Output,
    Reference,
    License,
    Other,
}

impl fmt::Display for AssetRole {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Input => "input",
            Self::Output => "output",
            Self::Reference => "reference",
            Self::License => "license",
            Self::Other => "other",
        })
    }
}

impl FromStr for AssetRole {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "input" => Ok(Self::Input),
            "output" => Ok(Self::Output),
            "reference" => Ok(Self::Reference),
            "license" => Ok(Self::License),
            "other" => Ok(Self::Other),
            _ => Err(format!("unsupported asset role: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ToolInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Asset {
    pub asset_id: String,
    pub role: AssetRole,
    pub package_path: String,
    pub original_name: String,
    pub media_type: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub event_id: String,
    pub sequence: u64,
    pub event_type: String,
    pub created_at: String,
    pub previous_event_hash: Option<String>,
    pub payload: Value,
    pub event_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventChainSummary {
    pub algorithm: String,
    pub event_count: u64,
    pub root_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub spec_version: String,
    pub proof_id: String,
    pub created_at: String,
    pub tool: ToolInfo,
    pub project: ProjectInfo,
    pub assets: Vec<Asset>,
    pub event_chain: EventChainSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub workspace_version: String,
    pub created_at: String,
    pub project: ProjectInfo,
    pub assets: Vec<Asset>,
}

impl Workspace {
    pub fn new(created_at: String, project_name: Option<String>) -> Self {
        Self {
            workspace_version: WORKSPACE_VERSION.to_owned(),
            created_at,
            project: ProjectInfo { name: project_name },
            assets: Vec::new(),
        }
    }

    pub fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if self.workspace_version != WORKSPACE_VERSION {
            issues.push(ValidationIssue::new(
                "UNSUPPORTED_WORKSPACE_VERSION",
                "workspace_version",
                "Workspace version must be 0.2.0.",
            ));
        }
        validate_common(
            &self.created_at,
            &self.project,
            &self.assets,
            false,
            &mut issues,
        );
        issues
    }
}

impl Manifest {
    pub fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if self.spec_version != SCHEMA_VERSION {
            issues.push(ValidationIssue::new(
                "UNSUPPORTED_SPEC_VERSION",
                "spec_version",
                "Specification version must be 0.2.0.",
            ));
        }
        if validate_proof_id(&self.proof_id).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_PROOF_ID",
                "proof_id",
                "Proof ID must be a lowercase urn:uuid value.",
            ));
        }
        if self.tool.name != "aigc-proof" || self.tool.version != SCHEMA_VERSION {
            issues.push(ValidationIssue::new(
                "INVALID_TOOL",
                "tool",
                "Tool must identify aigc-proof version 0.2.0.",
            ));
        }
        validate_common(
            &self.created_at,
            &self.project,
            &self.assets,
            true,
            &mut issues,
        );
        if self.event_chain.algorithm != HASH_ALGORITHM {
            issues.push(ValidationIssue::new(
                "INVALID_EVENT_ALGORITHM",
                "event_chain.algorithm",
                "Event chain algorithm must be sha-256.",
            ));
        }
        match (
            self.event_chain.event_count,
            self.event_chain.root_hash.as_deref(),
        ) {
            (0, None) => {}
            (count, Some(hash)) if count > 0 && validate_sha256_hex(hash).is_ok() => {}
            _ => issues.push(ValidationIssue::new(
                "INVALID_EVENT_ROOT",
                "event_chain.root_hash",
                "Root hash must be null for no events and a lowercase SHA-256 otherwise.",
            )),
        }
        issues
    }
}

impl Event {
    pub fn validate(&self, expected_sequence: u64) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if validate_uuid(&self.event_id).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_EVENT_ID",
                "event_id",
                "Event ID must be a UUID.",
            ));
        }
        if self.sequence != expected_sequence {
            issues.push(ValidationIssue::new(
                "EVENT_SEQUENCE_INVALID",
                "sequence",
                "Event sequence must start at 1 and remain contiguous.",
            ));
        }
        if let Err(message) = validate_event_type(&self.event_type) {
            issues.push(ValidationIssue::new(
                "INVALID_EVENT_TYPE",
                "event_type",
                message,
            ));
        }
        if let Err(message) = validate_canonical_timestamp(&self.created_at) {
            issues.push(ValidationIssue::new(
                "INVALID_TIMESTAMP",
                "created_at",
                message,
            ));
        }
        if !self.payload.is_object() {
            issues.push(ValidationIssue::new(
                "INVALID_EVENT_PAYLOAD",
                "payload",
                "Event payload must be a JSON object.",
            ));
        }
        if self
            .previous_event_hash
            .as_deref()
            .is_some_and(|hash| validate_sha256_hex(hash).is_err())
        {
            issues.push(ValidationIssue::new(
                "INVALID_PREVIOUS_EVENT_HASH",
                "previous_event_hash",
                "Previous event hash must be null or lowercase SHA-256.",
            ));
        }
        if validate_sha256_hex(&self.event_hash).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_EVENT_HASH",
                "event_hash",
                "Event hash must be lowercase SHA-256.",
            ));
        }
        issues
    }
}

fn validate_common(
    created_at: &str,
    project: &ProjectInfo,
    assets: &[Asset],
    require_asset: bool,
    issues: &mut Vec<ValidationIssue>,
) {
    if let Err(message) = validate_canonical_timestamp(created_at) {
        issues.push(ValidationIssue::new(
            "INVALID_TIMESTAMP",
            "created_at",
            message,
        ));
    }
    if project
        .name
        .as_ref()
        .is_some_and(|name| name.is_empty() || name.len() > 200)
    {
        issues.push(ValidationIssue::new(
            "INVALID_PROJECT_NAME",
            "project.name",
            "Project name must be 1-200 bytes when present.",
        ));
    }
    if require_asset && assets.is_empty() {
        issues.push(ValidationIssue::new(
            "MISSING_ASSET",
            "assets",
            "At least one asset is required.",
        ));
    }
    let mut previous_path: Option<&str> = None;
    let mut folded_paths = std::collections::HashSet::new();
    let mut asset_ids = std::collections::HashSet::new();
    for (index, asset) in assets.iter().enumerate() {
        let prefix = format!("assets[{index}]");
        if validate_uuid(&asset.asset_id).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_ASSET_ID",
                format!("{prefix}.asset_id"),
                "Asset ID must be a UUID.",
            ));
        }
        if !asset_ids.insert(asset.asset_id.as_str()) {
            issues.push(ValidationIssue::new(
                "ASSET_ID_DUPLICATE",
                format!("{prefix}.asset_id"),
                "Asset IDs must be unique.",
            ));
        }
        if let Err(message) = validate_asset_role(asset.role.to_string().as_str()) {
            issues.push(ValidationIssue::new(
                "INVALID_ASSET_ROLE",
                format!("{prefix}.role"),
                message,
            ));
        }
        if let Err(message) = validate_package_path(&asset.package_path) {
            issues.push(ValidationIssue::new(
                "INVALID_PACKAGE_PATH",
                format!("{prefix}.package_path"),
                message,
            ));
        }
        let required_prefix = format!("assets/{}/", asset.role);
        if !asset.package_path.starts_with(&required_prefix) {
            issues.push(ValidationIssue::new(
                "ASSET_PATH_ROLE_MISMATCH",
                format!("{prefix}.package_path"),
                "Asset package path must be under assets/<role>/ for its declared role.",
            ));
        }
        if previous_path.is_some_and(|value| value >= asset.package_path.as_str()) {
            issues.push(ValidationIssue::new(
                "ASSETS_NOT_SORTED",
                "assets",
                "Assets must be strictly sorted by package_path.",
            ));
        }
        previous_path = Some(&asset.package_path);
        if !folded_paths.insert(asset.package_path.to_lowercase()) {
            issues.push(ValidationIssue::new(
                "ASSET_PATH_CONFLICT",
                format!("{prefix}.package_path"),
                "Asset package paths must not duplicate or conflict by case.",
            ));
        }
        if validate_portable_basename(&asset.original_name).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_ORIGINAL_NAME",
                format!("{prefix}.original_name"),
                "Original name must be a portable basename.",
            ));
        }
        if validate_media_type(&asset.media_type).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_MEDIA_TYPE",
                format!("{prefix}.media_type"),
                "Media type must be a non-empty ASCII type/subtype value.",
            ));
        }
        if validate_sha256_hex(&asset.sha256).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_DIGEST",
                format!("{prefix}.sha256"),
                "Asset SHA-256 must be 64 lowercase hexadecimal characters.",
            ));
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VerificationStatus {
    Valid,
    Invalid,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Fail,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InternalIntegrity {
    Valid,
    Invalid,
    NotEvaluated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityAssurance {
    NotVerified,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignatureAssurance {
    NotPresent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimeAssurance {
    NotPresent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OriginalityAssurance {
    NotEvaluated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Assurance {
    pub internal_integrity: InternalIntegrity,
    pub creator_identity: IdentityAssurance,
    pub digital_signature: SignatureAssurance,
    pub trusted_time: TimeAssurance,
    pub originality: OriginalityAssurance,
}

impl Assurance {
    pub fn for_integrity(value: InternalIntegrity) -> Self {
        Self {
            internal_integrity: value,
            creator_identity: IdentityAssurance::NotVerified,
            digital_signature: SignatureAssurance::NotPresent,
            trusted_time: TimeAssurance::NotPresent,
            originality: OriginalityAssurance::NotEvaluated,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CheckResult {
    pub code: String,
    pub status: CheckStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VerificationError {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VerificationWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VerificationReport {
    pub spec_version: String,
    pub proof_id: Option<String>,
    pub verified_at: String,
    pub status: VerificationStatus,
    pub assurance: Assurance,
    pub checks: Vec<CheckResult>,
    pub errors: Vec<VerificationError>,
    pub warnings: Vec<VerificationWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Inspection {
    pub spec_version: String,
    pub proof_id: String,
    pub created_at: String,
    pub project: ProjectInfo,
    pub assets: Vec<Asset>,
    pub event_chain: EventChainSummary,
    pub assurance_level: String,
    pub verification_performed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationIssue {
    pub code: &'static str,
    pub field: String,
    pub message: String,
}

impl ValidationIssue {
    pub fn new(code: &'static str, field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            field: field.into(),
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(path: &str, id: &str) -> Asset {
        Asset {
            asset_id: id.to_owned(),
            role: AssetRole::Input,
            package_path: path.to_owned(),
            original_name: "file.txt".to_owned(),
            media_type: "text/plain".to_owned(),
            size_bytes: 1,
            sha256: "a".repeat(64),
        }
    }

    #[test]
    fn manifest_requires_stably_sorted_non_conflicting_assets() {
        let manifest = Manifest {
            spec_version: SCHEMA_VERSION.to_owned(),
            proof_id: "urn:uuid:550e8400-e29b-41d4-a716-446655440000".to_owned(),
            created_at: "2026-07-10T12:30:45Z".to_owned(),
            tool: ToolInfo {
                name: "aigc-proof".to_owned(),
                version: SCHEMA_VERSION.to_owned(),
            },
            project: ProjectInfo { name: None },
            assets: vec![
                asset("assets/input/z.txt", "550e8400-e29b-41d4-a716-446655440001"),
                asset("assets/input/a.txt", "550e8400-e29b-41d4-a716-446655440002"),
            ],
            event_chain: EventChainSummary {
                algorithm: HASH_ALGORITHM.to_owned(),
                event_count: 0,
                root_hash: None,
            },
        };
        assert!(
            manifest
                .validate()
                .iter()
                .any(|issue| issue.code == "ASSETS_NOT_SORTED")
        );
    }

    #[test]
    fn manifest_rejects_duplicate_asset_ids_and_role_path_mismatches() {
        let id = "550e8400-e29b-41d4-a716-446655440001";
        let mut first = asset("assets/input/a.txt", id);
        first.original_name = "a.txt".to_owned();
        let mut second = asset("assets/output/b.txt", id);
        second.role = AssetRole::Output;
        second.original_name = "b.txt".to_owned();
        let manifest = Manifest {
            spec_version: SCHEMA_VERSION.to_owned(),
            proof_id: "urn:uuid:550e8400-e29b-41d4-a716-446655440000".to_owned(),
            created_at: "2026-07-10T12:30:45Z".to_owned(),
            tool: ToolInfo {
                name: "aigc-proof".to_owned(),
                version: SCHEMA_VERSION.to_owned(),
            },
            project: ProjectInfo { name: None },
            assets: vec![first, second],
            event_chain: EventChainSummary {
                algorithm: HASH_ALGORITHM.to_owned(),
                event_count: 0,
                root_hash: None,
            },
        };
        assert!(
            manifest
                .validate()
                .iter()
                .any(|issue| issue.code == "ASSET_ID_DUPLICATE")
        );

        let mut mismatch = manifest;
        mismatch.assets[1].role = AssetRole::Input;
        assert!(
            mismatch
                .validate()
                .iter()
                .any(|issue| issue.code == "ASSET_PATH_ROLE_MISMATCH")
        );
    }
}
