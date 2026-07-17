use std::fs::{self, File};
use std::io::{Read, Write};
use std::sync::Mutex;

use proof_core::{
    AddAssetOptions, InitWorkspaceOptions, KeyStoreError, LocalSignerState, SealOptions,
    SignerKeyStore, SignerService, VerificationLimits, add_asset, canonical_json, init_workspace,
    seal_signed_workspace, seal_workspace, verify_package, verify_package_with_signer,
};
use proof_schema::{
    AssetRole, IdentityAssurance, SignatureAssurance, VerificationStatus,
    validate_verification_result_schema,
};
use tempfile::tempdir;
use uuid::Uuid;
use zeroize::Zeroizing;
use zip::write::SimpleFileOptions;

const NOW: &str = "2026-07-15T12:00:00Z";

#[derive(Default)]
struct MemoryStore(Mutex<Option<Zeroizing<Vec<u8>>>>);

impl SignerKeyStore for MemoryStore {
    fn load(&self) -> Result<Option<Zeroizing<Vec<u8>>>, KeyStoreError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .as_ref()
            .map(|value| Zeroizing::new(value.to_vec())))
    }

    fn store(&self, value: &[u8]) -> Result<(), KeyStoreError> {
        *self.0.lock().unwrap() = Some(Zeroizing::new(value.to_vec()));
        Ok(())
    }

    fn delete(&self) -> Result<(), KeyStoreError> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

fn workspace_with_asset(root: &std::path::Path) -> std::path::PathBuf {
    let workspace = root.join("workspace");
    let source = root.join("input.txt");
    fs::write(&source, b"signed package input").unwrap();
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: Some("signed test".to_owned()),
        created_at: NOW.to_owned(),
    })
    .unwrap();
    add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source,
        role: AssetRole::Input,
        asset_id: Uuid::new_v4().to_string(),
        media_type: "text/plain".to_owned(),
    })
    .unwrap();
    workspace
}

#[test]
fn protocol_10_signed_package_is_valid_and_trust_is_local() {
    let root = tempdir().unwrap();
    let workspace = workspace_with_asset(root.path());
    let package = root.path().join("signed.aigcproof");
    let signer = SignerService::new(MemoryStore::default());
    let created = signer.create("Creator 甲").unwrap();
    assert_eq!(created.state, LocalSignerState::Active);
    seal_signed_workspace(
        SealOptions {
            workspace,
            output: package.clone(),
            proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
            created_at: NOW.to_owned(),
        },
        &signer,
    )
    .unwrap();

    let untrusted = verify_package(&package, &VerificationLimits::default(), NOW.to_owned());
    assert_eq!(untrusted.status, VerificationStatus::Valid);
    assert_eq!(untrusted.spec_version, "1.0.0");
    assert_eq!(
        untrusted.assurance.digital_signature,
        SignatureAssurance::ValidUntrusted
    );
    assert_eq!(
        untrusted.assurance.creator_identity,
        IdentityAssurance::SelfAsserted
    );
    validate_verification_result_schema(&serde_json::to_value(&untrusted).unwrap()).unwrap();

    let trusted = verify_package_with_signer(
        &package,
        &VerificationLimits::default(),
        NOW.to_owned(),
        &signer,
    );
    assert_eq!(
        trusted.assurance.digital_signature,
        SignatureAssurance::ValidLocallyTrusted
    );
    assert_eq!(
        trusted.creator_signature.unwrap().key_fingerprint,
        created.key_fingerprint.unwrap()
    );
}

#[test]
fn protocol_02_unsigned_package_remains_internal_integrity_only() {
    let root = tempdir().unwrap();
    let workspace = workspace_with_asset(root.path());
    let package = root.path().join("legacy.aigcproof");
    seal_workspace(SealOptions {
        workspace,
        output: package.clone(),
        proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
        created_at: NOW.to_owned(),
    })
    .unwrap();
    let report = verify_package(&package, &VerificationLimits::default(), NOW.to_owned());
    assert_eq!(report.status, VerificationStatus::Valid);
    assert_eq!(report.spec_version, "0.2.0");
    assert_eq!(
        report.assurance.digital_signature,
        SignatureAssurance::NotPresent
    );
    assert!(report.creator_signature.is_none());
    validate_verification_result_schema(&serde_json::to_value(report).unwrap()).unwrap();
}

#[test]
fn signed_package_rejects_signature_key_and_manifest_identity_substitution() {
    let root = tempdir().unwrap();
    let workspace = workspace_with_asset(root.path());
    let package = root.path().join("signed.aigcproof");
    let signer = SignerService::new(MemoryStore::default());
    signer.create("Original creator").unwrap();
    let substitute_signer = SignerService::new(MemoryStore::default());
    substitute_signer.create("Substitute creator").unwrap();
    let substitute_key = substitute_signer.export_public_key().unwrap();
    seal_signed_workspace(
        SealOptions {
            workspace,
            output: package.clone(),
            proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
            created_at: NOW.to_owned(),
        },
        &signer,
    )
    .unwrap();

    for (mutation, expected_code) in [
        ("signature", "CREATOR_SIGNATURE_INVALID"),
        ("key", "CREATOR_KEY_FINGERPRINT_MISMATCH"),
        ("display-label", "CREATOR_SIGNATURE_INVALID"),
    ] {
        let mutated = root.path().join(format!("{mutation}.aigcproof"));
        rewrite_signed_package(&package, &mutated, mutation, &substitute_key);
        let report = verify_package(&mutated, &VerificationLimits::default(), NOW.to_owned());
        assert_eq!(report.status, VerificationStatus::Invalid, "{mutation}");
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.code == expected_code),
            "{mutation}: {:?}",
            report.errors
        );
    }
}

#[test]
fn protocol_10_rejects_version_downgrade_and_unknown_manifest_members() {
    let root = tempdir().unwrap();
    let workspace = workspace_with_asset(root.path());
    let package = root.path().join("signed.aigcproof");
    let signer = SignerService::new(MemoryStore::default());
    signer.create("Stable protocol creator").unwrap();
    seal_signed_workspace(
        SealOptions {
            workspace,
            output: package.clone(),
            proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
            created_at: NOW.to_owned(),
        },
        &signer,
    )
    .unwrap();
    let substitute_key = signer.export_public_key().unwrap();

    for mutation in ["spec-downgrade", "unknown-manifest-member"] {
        let mutated = root.path().join(format!("{mutation}.aigcproof"));
        rewrite_signed_package(&package, &mutated, mutation, &substitute_key);
        let report = verify_package(&mutated, &VerificationLimits::default(), NOW.to_owned());
        assert_eq!(report.status, VerificationStatus::Invalid, "{mutation}");
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.code == "MANIFEST_SCHEMA_INVALID"),
            "{mutation}: {:?}",
            report.errors
        );
    }
}

fn rewrite_signed_package(
    source: &std::path::Path,
    destination: &std::path::Path,
    mutation: &str,
    substitute_key: &[u8],
) {
    let mut archive = zip::ZipArchive::new(File::open(source).unwrap()).unwrap();
    let mut writer = zip::ZipWriter::new(File::create(destination).unwrap());
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        if mutation == "signature" && name == "security/signatures/creator.cose" {
            *bytes.last_mut().unwrap() ^= 1;
        } else if mutation == "key" && name.starts_with("security/keys/") {
            bytes = substitute_key.to_vec();
        } else if mutation == "display-label" && name == "manifest.json" {
            let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            value["security"]["creator_signature"]["display_label"] =
                serde_json::Value::String("Substituted creator".to_owned());
            bytes = canonical_json(&value).unwrap();
        } else if mutation == "spec-downgrade" && name == "manifest.json" {
            let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            value["spec_version"] = serde_json::Value::String("0.5.0".to_owned());
            bytes = canonical_json(&value).unwrap();
        } else if mutation == "unknown-manifest-member" && name == "manifest.json" {
            let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            value["future_noncritical"] = serde_json::json!({ "value": true });
            bytes = canonical_json(&value).unwrap();
        }
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&bytes).unwrap();
    }
    writer.finish().unwrap();
}
