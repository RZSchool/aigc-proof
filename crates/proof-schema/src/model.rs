use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

use crate::{
    C2PA_BRIDGE_PROFILE, C2PA_SCHEMA_VERSION, C2PA_TRUST_PROFILE, C2PA_WORKSPACE_VERSION,
    CREATOR_KEY_PREFIX, CREATOR_SIGNATURE_PATH, CREATOR_SIGNATURE_PROFILE,
    CREATOR_SIGNATURE_PROFILE_V03, CREATOR_SIGNATURE_PROFILE_V04, HASH_ALGORITHM,
    LEGACY_SCHEMA_VERSION, LEGACY_WORKSPACE_VERSION, SCHEMA_VERSION, SIGNED_SCHEMA_VERSION,
    SIGNED_WORKSPACE_VERSION, TRUSTED_SCHEMA_VERSION, TRUSTED_TIMESTAMP_PREFIX,
    TRUSTED_TIMESTAMP_PROFILE, TRUSTED_WORKSPACE_VERSION, TSA_TRUST_PROFILE, WORKSPACE_VERSION,
    validate_asset_role, validate_canonical_timestamp, validate_display_label, validate_event_type,
    validate_media_type, validate_package_path, validate_portable_basename, validate_proof_id,
    validate_sha256_hex, validate_uuid,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CreatorSignatureDescriptor {
    pub profile: String,
    pub signature_id: String,
    pub display_label: String,
    pub key_fingerprint: String,
    pub public_key_path: String,
    pub signature_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TrustedTimestampDescriptor {
    pub profile: String,
    pub timestamp_path: String,
    pub nonce: String,
    pub requested_policy: String,
    pub tsa_profile_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ManifestSecurity {
    pub creator_signature: CreatorSignatureDescriptor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trusted_timestamp: Option<TrustedTimestampDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TsaEndpointScope {
    PublicHttps,
    LoopbackTest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TsaRevocationSnapshot {
    #[serde(default)]
    pub crls_der_base64: Vec<String>,
    #[serde(default)]
    pub ocsp_responses_der_base64: Vec<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TsaTrustProfile {
    pub profile: String,
    pub source_label: String,
    pub endpoint: String,
    pub endpoint_scope: TsaEndpointScope,
    pub allowed_policy_oids: Vec<String>,
    pub roots_der_base64: Vec<String>,
    #[serde(default)]
    pub intermediates_der_base64: Vec<String>,
    #[serde(default)]
    pub https_roots_der_base64: Vec<String>,
    pub revocation: TsaRevocationSnapshot,
    pub effective_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TsaProfileSummary {
    pub profile_sha256: String,
    pub source_label: String,
    pub endpoint: String,
    pub endpoint_scope: TsaEndpointScope,
    pub allowed_policy_oids: Vec<String>,
    pub root_count: u64,
    pub intermediate_count: u64,
    pub https_root_count: u64,
    pub revocation_evidence_count: u64,
    pub effective_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct C2paTrustSnapshot {
    pub source_label: String,
    pub trust_anchors_pem: Vec<String>,
    #[serde(default)]
    pub allowed_ekus: Vec<String>,
    pub effective_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct C2paTrustProfile {
    pub profile: String,
    pub signer: C2paTrustSnapshot,
    pub timestamp: C2paTrustSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum C2paSourceMode {
    Embedded,
    Sidecar,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum C2paValidationState {
    Invalid,
    ValidUntrusted,
    Trusted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum C2paTrustState {
    NotEvaluated,
    Untrusted,
    Trusted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct C2paObservation {
    pub profile: String,
    pub asset_id: String,
    pub asset_sha256: String,
    pub manifest_store_sha256: String,
    pub source_mode: C2paSourceMode,
    pub claim_version: u8,
    pub active_manifest: String,
    pub signer_trust_snapshot_sha256: String,
    pub timestamp_trust_snapshot_sha256: String,
    pub validation_state: C2paValidationState,
    pub signer_trust: C2paTrustState,
    pub timestamp_trust: C2paTrustState,
    pub success_codes: Vec<String>,
    pub informational_codes: Vec<String>,
    pub failure_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum C2paAssurance {
    Absent,
    ObservedInvalid,
    ObservedValidUntrusted,
    ObservedTrusted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct C2paEvidence {
    pub state: C2paAssurance,
    pub observations: Vec<C2paObservation>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OfficialSubjectType {
    Person,
    Organization,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OfficialMethodClass {
    SyntheticTest,
    OrganizationControl,
    PersonPresence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OfficialConsentClaim {
    pub consent_id: uuid::Uuid,
    pub recorded_at: i64,
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OfficialAttestedSubject {
    pub opaque_id: String,
    pub subject_type: OfficialSubjectType,
    pub display_claim: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OfficialAttestation {
    pub profile: String,
    pub issuer: String,
    pub attestation_id: uuid::Uuid,
    pub subject: OfficialAttestedSubject,
    pub creator_key_fingerprint: String,
    pub method_class: OfficialMethodClass,
    pub purpose: String,
    pub consent: OfficialConsentClaim,
    pub issued_at: i64,
    pub expires_at: i64,
    pub status_endpoint_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OfficialStatusEntry {
    pub attestation_id: uuid::Uuid,
    pub status: String,
    pub effective_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OfficialStatusSnapshot {
    pub profile: String,
    pub issuer: String,
    pub sequence: i64,
    pub effective_at: i64,
    pub generated_at: i64,
    pub previous_digest: Option<String>,
    pub entries: Vec<OfficialStatusEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OfficialIssuerTrustSnapshot {
    pub profile: String,
    pub issuer: String,
    pub sequence: i64,
    pub key_id: String,
    pub algorithm: String,
    pub public_key_b64: String,
    pub valid_from: i64,
    pub valid_until: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OfficialIdentityAssurance {
    Absent,
    Unsupported,
    Malformed,
    Invalid,
    Untrusted,
    Revoked,
    Expired,
    Indeterminate,
    ValidTrusted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OfficialIdentityVerification {
    pub state: OfficialIdentityAssurance,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attestation_id: Option<uuid::Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_claim: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_key_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method_class: Option<OfficialMethodClass>,
    pub trust_sequence: i64,
    pub issuer_trust_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_sequence: Option<i64>,
    pub attestation_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_sha256: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<ManifestSecurity>,
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
        if !matches!(
            self.workspace_version.as_str(),
            LEGACY_WORKSPACE_VERSION
                | SIGNED_WORKSPACE_VERSION
                | TRUSTED_WORKSPACE_VERSION
                | C2PA_WORKSPACE_VERSION
                | WORKSPACE_VERSION
        ) {
            issues.push(ValidationIssue::new(
                "UNSUPPORTED_WORKSPACE_VERSION",
                "workspace_version",
                "Workspace version must be 0.2.0, 0.3.0, 0.4.0, 0.5.0, or 1.0.0.",
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
        if !matches!(
            self.spec_version.as_str(),
            LEGACY_SCHEMA_VERSION
                | SIGNED_SCHEMA_VERSION
                | TRUSTED_SCHEMA_VERSION
                | C2PA_SCHEMA_VERSION
                | SCHEMA_VERSION
        ) {
            issues.push(ValidationIssue::new(
                "UNSUPPORTED_SPEC_VERSION",
                "spec_version",
                "Specification version must be 0.2.0, 0.3.0, 0.4.0, 0.5.0, or 1.0.0.",
            ));
        }
        if validate_proof_id(&self.proof_id).is_err() {
            issues.push(ValidationIssue::new(
                "INVALID_PROOF_ID",
                "proof_id",
                "Proof ID must be a lowercase urn:uuid value.",
            ));
        }
        if self.tool.name != "aigc-proof" || self.tool.version != self.spec_version {
            issues.push(ValidationIssue::new(
                "INVALID_TOOL",
                "tool",
                "Tool must identify aigc-proof at the declared specification version.",
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
        match (self.spec_version.as_str(), self.security.as_ref()) {
            (LEGACY_SCHEMA_VERSION, None) => {}
            (LEGACY_SCHEMA_VERSION, Some(_)) => issues.push(ValidationIssue::new(
                "LEGACY_SECURITY_FORBIDDEN",
                "security",
                "Protocol 0.2 manifests must not contain creator signature metadata.",
            )),
            (SIGNED_SCHEMA_VERSION, Some(security)) => {
                validate_creator_signature(
                    &security.creator_signature,
                    CREATOR_SIGNATURE_PROFILE_V03,
                    &mut issues,
                );
                if security.trusted_timestamp.is_some() {
                    issues.push(ValidationIssue::new(
                        "SIGNED_V03_TIMESTAMP_FORBIDDEN",
                        "security.trusted_timestamp",
                        "Protocol 0.3 must not contain RFC 3161 timestamp metadata.",
                    ));
                }
            }
            (SIGNED_SCHEMA_VERSION, None) => issues.push(ValidationIssue::new(
                "CREATOR_SIGNATURE_ABSENT",
                "security",
                "Protocol 0.3 manifests require creator signature metadata.",
            )),
            (TRUSTED_SCHEMA_VERSION, Some(security)) => {
                validate_creator_signature(
                    &security.creator_signature,
                    CREATOR_SIGNATURE_PROFILE_V04,
                    &mut issues,
                );
                match security.trusted_timestamp.as_ref() {
                    Some(timestamp) => validate_trusted_timestamp(
                        timestamp,
                        &security.creator_signature.signature_id,
                        &mut issues,
                    ),
                    None => issues.push(ValidationIssue::new(
                        "TRUSTED_TIMESTAMP_PLAN_ABSENT",
                        "security.trusted_timestamp",
                        "Protocol 0.4 manifests require a predeclared RFC 3161 timestamp plan.",
                    )),
                }
            }
            (TRUSTED_SCHEMA_VERSION, None) => issues.push(ValidationIssue::new(
                "CREATOR_SIGNATURE_ABSENT",
                "security",
                "Protocol 0.4 manifests require creator signature and timestamp-plan metadata.",
            )),
            (C2PA_SCHEMA_VERSION, Some(security)) => {
                validate_creator_signature(
                    &security.creator_signature,
                    CREATOR_SIGNATURE_PROFILE,
                    &mut issues,
                );
                match security.trusted_timestamp.as_ref() {
                    Some(timestamp) => validate_trusted_timestamp(
                        timestamp,
                        &security.creator_signature.signature_id,
                        &mut issues,
                    ),
                    None => issues.push(ValidationIssue::new(
                        "TRUSTED_TIMESTAMP_PLAN_ABSENT",
                        "security.trusted_timestamp",
                        "Protocol 0.5 manifests require a predeclared RFC 3161 timestamp plan.",
                    )),
                }
            }
            (C2PA_SCHEMA_VERSION, None) => issues.push(ValidationIssue::new(
                "CREATOR_SIGNATURE_ABSENT",
                "security",
                "Protocol 0.5 manifests require creator signature and timestamp-plan metadata.",
            )),
            (SCHEMA_VERSION, Some(security)) => {
                validate_creator_signature(
                    &security.creator_signature,
                    CREATOR_SIGNATURE_PROFILE,
                    &mut issues,
                );
                if let Some(timestamp) = security.trusted_timestamp.as_ref() {
                    validate_trusted_timestamp(
                        timestamp,
                        &security.creator_signature.signature_id,
                        &mut issues,
                    );
                }
            }
            (SCHEMA_VERSION, None) => issues.push(ValidationIssue::new(
                "CREATOR_SIGNATURE_ABSENT",
                "security",
                "Protocol 1.0 manifests require creator-signature metadata; trusted time remains optional and independent.",
            )),
            _ => {}
        }
        issues
    }
}

fn validate_trusted_timestamp(
    timestamp: &TrustedTimestampDescriptor,
    signature_id: &str,
    issues: &mut Vec<ValidationIssue>,
) {
    if timestamp.profile != TRUSTED_TIMESTAMP_PROFILE {
        issues.push(ValidationIssue::new(
            "TRUSTED_TIMESTAMP_PROFILE_UNSUPPORTED",
            "security.trusted_timestamp.profile",
            "Trusted timestamp profile is unsupported.",
        ));
    }
    let expected_path = format!("{TRUSTED_TIMESTAMP_PREFIX}{signature_id}.tsr");
    if timestamp.timestamp_path != expected_path {
        issues.push(ValidationIssue::new(
            "TRUSTED_TIMESTAMP_PATH_INVALID",
            "security.trusted_timestamp.timestamp_path",
            "Timestamp response path must be derived from the creator signature ID.",
        ));
    }
    if timestamp.nonce.len() != 32
        || !timestamp
            .nonce
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        issues.push(ValidationIssue::new(
            "TRUSTED_TIMESTAMP_NONCE_INVALID",
            "security.trusted_timestamp.nonce",
            "Timestamp nonce must be 128 unsigned random bits encoded as 32 lowercase hex digits.",
        ));
    }
    if timestamp.requested_policy != "any" && !valid_oid(&timestamp.requested_policy) {
        issues.push(ValidationIssue::new(
            "TRUSTED_TIMESTAMP_POLICY_INVALID",
            "security.trusted_timestamp.requested_policy",
            "Requested timestamp policy must be an object identifier or the explicit any marker.",
        ));
    }
    if validate_sha256_hex(&timestamp.tsa_profile_sha256).is_err() {
        issues.push(ValidationIssue::new(
            "TSA_PROFILE_DIGEST_INVALID",
            "security.trusted_timestamp.tsa_profile_sha256",
            "TSA profile digest must be lowercase SHA-256 hexadecimal.",
        ));
    }
}

impl TsaTrustProfile {
    pub fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if self.profile != TSA_TRUST_PROFILE {
            issues.push(ValidationIssue::new(
                "TSA_PROFILE_UNSUPPORTED",
                "profile",
                "TSA trust profile identifier is unsupported.",
            ));
        }
        if validate_display_label(&self.source_label).is_err() {
            issues.push(ValidationIssue::new(
                "TSA_SOURCE_LABEL_INVALID",
                "source_label",
                "TSA source label must be non-empty safe NFC text.",
            ));
        }
        let endpoint = url::Url::parse(&self.endpoint).ok();
        let loopback = endpoint
            .as_ref()
            .and_then(url::Url::host_str)
            .is_some_and(|host| {
                host.eq_ignore_ascii_case("localhost")
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|address| address.is_loopback())
            });
        let endpoint_invalid = self.endpoint.len() > 2048
            || endpoint.as_ref().is_none_or(|endpoint| {
                endpoint.scheme() != "https"
                    || endpoint.host_str().is_none()
                    || !endpoint.username().is_empty()
                    || endpoint.password().is_some()
                    || endpoint.fragment().is_some()
            })
            || matches!(self.endpoint_scope, TsaEndpointScope::LoopbackTest) && !loopback
            || matches!(self.endpoint_scope, TsaEndpointScope::PublicHttps) && loopback;
        if endpoint_invalid {
            issues.push(ValidationIssue::new(
                "TSA_ENDPOINT_INVALID",
                "endpoint",
                "TSA endpoint must be a credential-free scoped HTTPS URL without a fragment.",
            ));
        }
        if self.allowed_policy_oids.is_empty()
            || self.allowed_policy_oids.len() > 32
            || self
                .allowed_policy_oids
                .iter()
                .any(|value| !valid_oid(value))
        {
            issues.push(ValidationIssue::new(
                "TSA_POLICY_SET_INVALID",
                "allowed_policy_oids",
                "TSA profile must contain one to 32 valid policy object identifiers.",
            ));
        }
        if self.roots_der_base64.is_empty() || self.roots_der_base64.len() > 16 {
            issues.push(ValidationIssue::new(
                "TSA_ROOTS_INVALID",
                "roots_der_base64",
                "TSA profile must contain one to 16 explicit trust roots.",
            ));
        }
        let certificate_fields = self
            .roots_der_base64
            .iter()
            .chain(self.intermediates_der_base64.iter())
            .chain(self.https_roots_der_base64.iter());
        if certificate_fields
            .clone()
            .any(|value| !valid_base64_blob(value, 256 * 1024))
            || self.intermediates_der_base64.len() > 32
            || self.https_roots_der_base64.len() > 16
        {
            issues.push(ValidationIssue::new(
                "TSA_CERTIFICATE_DATA_INVALID",
                "roots_der_base64",
                "TSA certificate data must be bounded canonical base64 DER.",
            ));
        }
        if self.revocation.crls_der_base64.len() > 32
            || self.revocation.ocsp_responses_der_base64.len() > 32
            || self
                .revocation
                .crls_der_base64
                .iter()
                .chain(self.revocation.ocsp_responses_der_base64.iter())
                .any(|value| !valid_base64_blob(value, 1024 * 1024))
        {
            issues.push(ValidationIssue::new(
                "TSA_REVOCATION_DATA_INVALID",
                "revocation",
                "Revocation evidence must be bounded canonical base64 DER.",
            ));
        }
        if validate_canonical_timestamp(&self.effective_at).is_err()
            || validate_canonical_timestamp(&self.expires_at).is_err()
            || self.effective_at >= self.expires_at
        {
            issues.push(ValidationIssue::new(
                "TSA_PROFILE_VALIDITY_INVALID",
                "effective_at",
                "TSA profile effective and expiry times must be ordered canonical UTC timestamps.",
            ));
        }
        issues
    }
}

impl C2paTrustProfile {
    pub fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if self.profile != C2PA_TRUST_PROFILE {
            issues.push(ValidationIssue::new(
                "C2PA_TRUST_PROFILE_UNSUPPORTED",
                "profile",
                "C2PA trust profile identifier is unsupported.",
            ));
        }
        validate_c2pa_trust_snapshot("signer", &self.signer, &mut issues);
        validate_c2pa_trust_snapshot("timestamp", &self.timestamp, &mut issues);
        issues
    }
}

impl C2paObservation {
    pub fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if self.profile != C2PA_BRIDGE_PROFILE {
            issues.push(ValidationIssue::new(
                "C2PA_OBSERVATION_PROFILE_UNSUPPORTED",
                "profile",
                "C2PA observation profile is unsupported.",
            ));
        }
        if validate_uuid(&self.asset_id).is_err() {
            issues.push(ValidationIssue::new(
                "C2PA_ASSET_ID_INVALID",
                "asset_id",
                "C2PA observation asset ID must be a lowercase UUID.",
            ));
        }
        for (field, digest) in [
            ("asset_sha256", &self.asset_sha256),
            ("manifest_store_sha256", &self.manifest_store_sha256),
            (
                "signer_trust_snapshot_sha256",
                &self.signer_trust_snapshot_sha256,
            ),
            (
                "timestamp_trust_snapshot_sha256",
                &self.timestamp_trust_snapshot_sha256,
            ),
        ] {
            if validate_sha256_hex(digest).is_err() {
                issues.push(ValidationIssue::new(
                    "C2PA_DIGEST_INVALID",
                    field,
                    "C2PA observation digests must be lowercase SHA-256 hexadecimal.",
                ));
            }
        }
        if !matches!(self.claim_version, 1 | 2) {
            issues.push(ValidationIssue::new(
                "C2PA_CLAIM_VERSION_UNSUPPORTED",
                "claim_version",
                "Only C2PA claim versions 1 and 2 are supported by this bridge profile.",
            ));
        }
        if !valid_c2pa_text(&self.active_manifest, 512) {
            issues.push(ValidationIssue::new(
                "C2PA_ACTIVE_MANIFEST_INVALID",
                "active_manifest",
                "Active manifest label must be bounded visible NFC text without controls.",
            ));
        }
        for (field, codes) in [
            ("success_codes", &self.success_codes),
            ("informational_codes", &self.informational_codes),
            ("failure_codes", &self.failure_codes),
        ] {
            if codes.len() > 256
                || codes.iter().any(|code| !valid_c2pa_status_code(code))
                || codes.windows(2).any(|pair| pair[0] >= pair[1])
            {
                issues.push(ValidationIssue::new(
                    "C2PA_STATUS_CODES_INVALID",
                    field,
                    "C2PA status codes must be unique, sorted and bounded protocol tokens.",
                ));
            }
        }
        if matches!(self.validation_state, C2paValidationState::Trusted)
            && !matches!(self.signer_trust, C2paTrustState::Trusted)
        {
            issues.push(ValidationIssue::new(
                "C2PA_TRUST_STATE_INCONSISTENT",
                "signer_trust",
                "A trusted C2PA observation requires a trusted signer result.",
            ));
        }
        issues
    }
}

fn validate_c2pa_trust_snapshot(
    field: &str,
    snapshot: &C2paTrustSnapshot,
    issues: &mut Vec<ValidationIssue>,
) {
    if validate_display_label(&snapshot.source_label).is_err() {
        issues.push(ValidationIssue::new(
            "C2PA_TRUST_SOURCE_LABEL_INVALID",
            format!("{field}.source_label"),
            "C2PA trust snapshot source label must be non-empty safe NFC text.",
        ));
    }
    if snapshot.trust_anchors_pem.is_empty()
        || snapshot.trust_anchors_pem.len() > 32
        || snapshot
            .trust_anchors_pem
            .iter()
            .any(|value| !valid_pem_certificate(value))
    {
        issues.push(ValidationIssue::new(
            "C2PA_TRUST_ANCHORS_INVALID",
            format!("{field}.trust_anchors_pem"),
            "C2PA trust snapshot must contain one to 32 bounded PEM certificates and no private material.",
        ));
    }
    if snapshot.allowed_ekus.is_empty()
        || snapshot.allowed_ekus.len() > 32
        || snapshot.allowed_ekus.iter().any(|value| !valid_oid(value))
    {
        issues.push(ValidationIssue::new(
            "C2PA_TRUST_EKUS_INVALID",
            format!("{field}.allowed_ekus"),
            "C2PA trust snapshot must contain one to 32 valid extended-key-usage OIDs.",
        ));
    }
    if validate_canonical_timestamp(&snapshot.effective_at).is_err()
        || validate_canonical_timestamp(&snapshot.expires_at).is_err()
        || snapshot.effective_at >= snapshot.expires_at
    {
        issues.push(ValidationIssue::new(
            "C2PA_TRUST_VALIDITY_INVALID",
            format!("{field}.effective_at"),
            "C2PA trust snapshot effective and expiry times must be ordered canonical UTC timestamps.",
        ));
    }
}

fn valid_pem_certificate(value: &str) -> bool {
    value.len() <= 256 * 1024
        && value.is_ascii()
        && value.starts_with("-----BEGIN CERTIFICATE-----\n")
        && value.ends_with("-----END CERTIFICATE-----\n")
        && !value.contains("PRIVATE")
        && !value.contains('\0')
}

fn valid_c2pa_text(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && value.nfc().eq(value.chars())
        && !value.chars().any(char::is_control)
}

fn valid_c2pa_status_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
}

fn valid_oid(value: &str) -> bool {
    let mut components = value.split('.');
    let Some(first) = components.next() else {
        return false;
    };
    let Some(second) = components.next() else {
        return false;
    };
    let Ok(first) = first.parse::<u8>() else {
        return false;
    };
    let Ok(second) = second.parse::<u64>() else {
        return false;
    };
    if first > 2 || (first < 2 && second > 39) {
        return false;
    }
    components.all(|component| {
        !component.is_empty()
            && (component == "0" || !component.starts_with('0'))
            && component.parse::<u64>().is_ok()
    })
}

fn valid_base64_blob(value: &str, max_decoded: usize) -> bool {
    !value.is_empty()
        && value.len()
            <= max_decoded
                .saturating_mul(4)
                .saturating_div(3)
                .saturating_add(4)
        && value.len() % 4 == 0
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

fn validate_creator_signature(
    signature: &CreatorSignatureDescriptor,
    expected_profile: &str,
    issues: &mut Vec<ValidationIssue>,
) {
    if signature.profile != expected_profile {
        issues.push(ValidationIssue::new(
            "CREATOR_SIGNATURE_PROFILE_UNSUPPORTED",
            "security.creator_signature.profile",
            "Creator signature profile is unsupported.",
        ));
    }
    if validate_sha256_hex(&signature.signature_id).is_err() {
        issues.push(ValidationIssue::new(
            "CREATOR_SIGNATURE_ID_INVALID",
            "security.creator_signature.signature_id",
            "Signature ID must be 32 random bytes encoded as lowercase hexadecimal.",
        ));
    }
    if let Err(message) = validate_display_label(&signature.display_label) {
        issues.push(ValidationIssue::new(
            "CREATOR_DISPLAY_LABEL_INVALID",
            "security.creator_signature.display_label",
            message,
        ));
    }
    if validate_sha256_hex(&signature.key_fingerprint).is_err() {
        issues.push(ValidationIssue::new(
            "CREATOR_KEY_FINGERPRINT_INVALID",
            "security.creator_signature.key_fingerprint",
            "Key fingerprint must be lowercase SHA-256 hexadecimal.",
        ));
    }
    let expected_key_path = format!("{CREATOR_KEY_PREFIX}{}.cbor", signature.key_fingerprint);
    if signature.public_key_path != expected_key_path {
        issues.push(ValidationIssue::new(
            "CREATOR_KEY_PATH_INVALID",
            "security.creator_signature.public_key_path",
            "Public key path must be derived from the key fingerprint.",
        ));
    }
    if signature.signature_path != CREATOR_SIGNATURE_PATH {
        issues.push(ValidationIssue::new(
            "CREATOR_SIGNATURE_PATH_INVALID",
            "security.creator_signature.signature_path",
            "Creator signature must use the protocol-defined package path.",
        ));
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
    SelfAsserted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignatureAssurance {
    NotPresent,
    Absent,
    Unsupported,
    Malformed,
    Invalid,
    ValidUntrusted,
    ValidLocallyTrusted,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimeAssurance {
    NotPresent,
    Absent,
    AcquisitionFailed,
    Malformed,
    ImprintMismatch,
    NonceMismatch,
    PolicyMismatch,
    InvalidSignature,
    InvalidChain,
    InvalidEku,
    InvalidEss,
    Untrusted,
    ExpiredOrStale,
    IndeterminateRevocation,
    UnsupportedAlgorithm,
    ValidTrusted,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub official_identity: Option<OfficialIdentityAssurance>,
    pub digital_signature: SignatureAssurance,
    pub trusted_time: TimeAssurance,
    pub originality: OriginalityAssurance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalTrust {
    Untrusted,
    Trusted,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CreatorSignatureEvidence {
    pub display_label: String,
    pub key_fingerprint: String,
    pub profile: String,
    pub local_trust: LocalTrust,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RevocationEvidenceState {
    NotProvided,
    ValidCrl,
    Revoked,
    Indeterminate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TrustedTimeEvidence {
    pub profile: String,
    pub timestamp_path: String,
    pub tsa_profile_sha256: String,
    pub requested_policy: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub granted_policy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gen_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_label: Option<String>,
    pub revocation: RevocationEvidenceState,
}

impl Assurance {
    pub fn for_integrity(value: InternalIntegrity) -> Self {
        Self {
            internal_integrity: value,
            creator_identity: IdentityAssurance::NotVerified,
            official_identity: None,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_signature: Option<CreatorSignatureEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trusted_time: Option<TrustedTimeEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c2pa: Option<C2paEvidence>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_signature: Option<CreatorSignatureDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trusted_timestamp: Option<TrustedTimestampDescriptor>,
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
            security: None,
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
            security: None,
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
