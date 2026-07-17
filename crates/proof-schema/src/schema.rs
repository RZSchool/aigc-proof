use serde_json::Value;

const MANIFEST_SCHEMA_V02: &str = include_str!("../../../schemas/v0.2/manifest.schema.json");
const MANIFEST_SCHEMA_V03: &str = include_str!("../../../schemas/v0.3/manifest.schema.json");
const MANIFEST_SCHEMA_V04: &str = include_str!("../../../schemas/v0.4/manifest.schema.json");
const MANIFEST_SCHEMA_V05: &str = include_str!("../../../schemas/v0.5/manifest.schema.json");
const MANIFEST_SCHEMA_V10: &str = include_str!("../../../schemas/v1.0/manifest.schema.json");
const EVENT_SCHEMA: &str = include_str!("../../../schemas/v0.2/event.schema.json");
const REPORT_SCHEMA_V02: &str =
    include_str!("../../../schemas/v0.2/verification-result.schema.json");
const REPORT_SCHEMA_V03: &str =
    include_str!("../../../schemas/v0.3/verification-result.schema.json");
const REPORT_SCHEMA_V04: &str =
    include_str!("../../../schemas/v0.4/verification-result.schema.json");
const REPORT_SCHEMA_V05: &str =
    include_str!("../../../schemas/v0.5/verification-result.schema.json");
const REPORT_SCHEMA_V10: &str =
    include_str!("../../../schemas/v1.0/verification-result.schema.json");
const WORKSPACE_SCHEMA_V02: &str = include_str!("../../../schemas/v0.2/workspace.schema.json");
const WORKSPACE_SCHEMA_V03: &str = include_str!("../../../schemas/v0.3/workspace.schema.json");
const WORKSPACE_SCHEMA_V04: &str = include_str!("../../../schemas/v0.4/workspace.schema.json");
const WORKSPACE_SCHEMA_V05: &str = include_str!("../../../schemas/v0.5/workspace.schema.json");
const WORKSPACE_SCHEMA_V10: &str = include_str!("../../../schemas/v1.0/workspace.schema.json");
const TSA_PROFILE_SCHEMA: &str = include_str!("../../../schemas/v0.4/tsa-profile.schema.json");
const C2PA_PROFILE_SCHEMA: &str =
    include_str!("../../../schemas/v0.5/c2pa-trust-profile.schema.json");
const OFFICIAL_ATTESTATION_SCHEMA: &str =
    include_str!("../../../schemas/v1.0/official-attestation-v1.schema.json");
const OFFICIAL_STATUS_SCHEMA: &str =
    include_str!("../../../schemas/v1.0/official-status-snapshot-v1.schema.json");
const OFFICIAL_TRUST_SCHEMA: &str =
    include_str!("../../../schemas/v1.0/official-issuer-trust-v1.schema.json");

pub fn validate_manifest_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(
        versioned(
            value,
            "spec_version",
            MANIFEST_SCHEMA_V02,
            MANIFEST_SCHEMA_V03,
            MANIFEST_SCHEMA_V04,
            MANIFEST_SCHEMA_V05,
            MANIFEST_SCHEMA_V10,
        ),
        value,
    )
}

pub fn validate_event_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(EVENT_SCHEMA, value)
}

pub fn validate_verification_result_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(
        versioned(
            value,
            "spec_version",
            REPORT_SCHEMA_V02,
            REPORT_SCHEMA_V03,
            REPORT_SCHEMA_V04,
            REPORT_SCHEMA_V05,
            REPORT_SCHEMA_V10,
        ),
        value,
    )
}

pub fn validate_workspace_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(
        versioned(
            value,
            "workspace_version",
            WORKSPACE_SCHEMA_V02,
            WORKSPACE_SCHEMA_V03,
            WORKSPACE_SCHEMA_V04,
            WORKSPACE_SCHEMA_V05,
            WORKSPACE_SCHEMA_V10,
        ),
        value,
    )
}

pub fn validate_tsa_profile_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(TSA_PROFILE_SCHEMA, value)
}

pub fn validate_c2pa_profile_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(C2PA_PROFILE_SCHEMA, value)
}

pub fn validate_official_attestation_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(OFFICIAL_ATTESTATION_SCHEMA, value)
}

pub fn validate_official_status_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(OFFICIAL_STATUS_SCHEMA, value)
}

pub fn validate_official_trust_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(OFFICIAL_TRUST_SCHEMA, value)
}

fn versioned<'a>(
    value: &Value,
    field: &str,
    legacy: &'a str,
    signed: &'a str,
    trusted: &'a str,
    c2pa: &'a str,
    current: &'a str,
) -> &'a str {
    match value.get(field).and_then(Value::as_str) {
        Some(crate::LEGACY_SCHEMA_VERSION) => legacy,
        Some(crate::SIGNED_SCHEMA_VERSION) => signed,
        Some(crate::TRUSTED_SCHEMA_VERSION) => trusted,
        Some(crate::C2PA_SCHEMA_VERSION) => c2pa,
        _ => current,
    }
}

fn validate(schema_text: &str, instance: &Value) -> Result<(), Vec<String>> {
    let schema: Value = serde_json::from_str(schema_text)
        .map_err(|error| vec![format!("invalid embedded schema: {error}")])?;
    let validator = jsonschema::draft202012::options()
        .should_validate_formats(false)
        .build(&schema)
        .map_err(|error| vec![format!("cannot compile embedded schema: {error}")])?;
    let errors: Vec<String> = validator
        .iter_errors(instance)
        .map(|error| error.to_string())
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        Asset, AssetRole, EventChainSummary, Manifest, ProjectInfo, ToolInfo,
        validate_package_path, validate_sha256_hex,
    };
    use serde_json::json;

    use super::*;

    #[test]
    fn embedded_schemas_load_and_reject_invalid_values() {
        let invalid = json!({"spec_version": "0.2.0"});
        assert!(validate_manifest_schema(&invalid).is_err());
        let schema = serde_json::from_str::<Value>(MANIFEST_SCHEMA_V03).unwrap();
        assert!(jsonschema::validator_for(&schema).is_ok());
    }

    #[test]
    fn schema_and_rust_accept_valid_manifest_and_reject_bad_digests() {
        let manifest = Manifest {
            spec_version: "0.2.0".to_owned(),
            proof_id: "urn:uuid:550e8400-e29b-41d4-a716-446655440000".to_owned(),
            created_at: "2026-07-10T12:30:45Z".to_owned(),
            tool: ToolInfo {
                name: "aigc-proof".to_owned(),
                version: "0.2.0".to_owned(),
            },
            project: ProjectInfo {
                name: Some("test".to_owned()),
            },
            assets: vec![Asset {
                asset_id: "550e8400-e29b-41d4-a716-446655440001".to_owned(),
                role: AssetRole::Input,
                package_path: "assets/input/example.txt".to_owned(),
                original_name: "example.txt".to_owned(),
                media_type: "text/plain".to_owned(),
                size_bytes: 3,
                sha256: "a".repeat(64),
            }],
            event_chain: EventChainSummary {
                algorithm: "sha-256".to_owned(),
                event_count: 0,
                root_hash: None,
            },
            security: None,
        };
        let valid = serde_json::to_value(&manifest).unwrap();
        assert!(validate_manifest_schema(&valid).is_ok());
        assert!(validate_package_path("assets/input/example.txt").is_ok());
        assert!(validate_sha256_hex(&"a".repeat(64)).is_ok());

        let mut uppercase = valid.clone();
        uppercase["assets"][0]["sha256"] = json!("A".repeat(64));
        assert!(validate_manifest_schema(&uppercase).is_err());
        assert!(validate_sha256_hex(&"A".repeat(64)).is_err());

        let mut short = valid;
        short["assets"][0]["sha256"] = json!("a".repeat(63));
        assert!(validate_manifest_schema(&short).is_err());
        assert!(validate_sha256_hex(&"a".repeat(63)).is_err());
    }

    #[test]
    fn schemas_enforce_cross_field_status_and_chain_rules() {
        let invalid_event = json!({
            "event_id": "550e8400-e29b-41d4-a716-446655440000",
            "sequence": 1,
            "event_type": "generation",
            "created_at": "2026-07-10T12:30:45Z",
            "previous_event_hash": "a".repeat(64),
            "payload": {},
            "event_hash": "b".repeat(64)
        });
        assert!(validate_event_schema(&invalid_event).is_err());

        let invalid_report = json!({
            "spec_version": "0.2.0",
            "proof_id": null,
            "verified_at": "2026-07-10T12:30:45Z",
            "status": "valid",
            "assurance": {
                "internal_integrity": "invalid",
                "creator_identity": "not_verified",
                "digital_signature": "not_present",
                "trusted_time": "not_present",
                "originality": "not_evaluated"
            },
            "checks": [],
            "errors": [{"code": "BAD", "message": "bad"}],
            "warnings": []
        });
        assert!(validate_verification_result_schema(&invalid_report).is_err());
    }
}
