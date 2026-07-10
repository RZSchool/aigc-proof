use serde_json::Value;

const MANIFEST_SCHEMA: &str = include_str!("../../../schemas/v0.2/manifest.schema.json");
const EVENT_SCHEMA: &str = include_str!("../../../schemas/v0.2/event.schema.json");
const REPORT_SCHEMA: &str =
    include_str!("../../../schemas/v0.2/verification-result.schema.json");
const WORKSPACE_SCHEMA: &str = include_str!("../../../schemas/v0.2/workspace.schema.json");

pub fn validate_manifest_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(MANIFEST_SCHEMA, value)
}

pub fn validate_event_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(EVENT_SCHEMA, value)
}

pub fn validate_verification_result_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(REPORT_SCHEMA, value)
}

pub fn validate_workspace_schema(value: &Value) -> Result<(), Vec<String>> {
    validate(WORKSPACE_SCHEMA, value)
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
        let schema = serde_json::from_str::<Value>(MANIFEST_SCHEMA).unwrap();
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
}
