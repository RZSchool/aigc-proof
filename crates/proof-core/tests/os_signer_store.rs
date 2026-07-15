use std::fs;

use proof_core::{
    AddAssetOptions, InitWorkspaceOptions, LocalSignerState, OsSignerKeyStore, SealOptions,
    SignerService, VerificationLimits, add_asset, init_workspace, seal_signed_workspace,
    verify_package_with_signer,
};
use proof_schema::{AssetRole, SignatureAssurance};
use tempfile::tempdir;
use uuid::Uuid;

struct CleanupGuard {
    service: String,
    user: String,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        let _ = SignerService::new(OsSignerKeyStore::new(&self.service, &self.user)).cleanup();
    }
}

#[test]
#[ignore = "requires explicit access to the operating-system credential store"]
fn os_credential_store_lifecycle() {
    let service = format!("org.aigcproof.test.{}", Uuid::new_v4());
    let user = "ap-031-isolated-test".to_owned();
    let _guard = CleanupGuard {
        service: service.clone(),
        user: user.clone(),
    };
    let signer = SignerService::new(OsSignerKeyStore::new(service, user));
    if let Err(error) = signer.cleanup() {
        #[cfg(target_os = "linux")]
        {
            assert_eq!(error.code, "SIGNER_STORE_UNAVAILABLE");
            assert_eq!(signer.status().state, LocalSignerState::Unavailable);
            assert_eq!(
                signer.create("Unavailable store").unwrap_err().code,
                "SIGNER_STORE_UNAVAILABLE"
            );
            println!("persistent credential store unavailable: fail-closed path passed");
            return;
        }
        #[cfg(not(target_os = "linux"))]
        panic!("credential-store cleanup failed: {error}");
    }
    assert_eq!(signer.status().state, LocalSignerState::Missing);

    let created = signer.create("AP-031 Windows credential test").unwrap();
    assert_eq!(created.state, LocalSignerState::Active);
    assert_eq!(signer.status(), created);
    let public_key = signer.export_public_key().unwrap();
    assert!(!public_key.is_empty());

    let root = tempdir().unwrap();
    let workspace = root.path().join("workspace");
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: Some("OS credential lifecycle".to_owned()),
        created_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap();
    let source = root.path().join("input.txt");
    fs::write(&source, b"OS credential signed package input").unwrap();
    add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source,
        role: AssetRole::Input,
        asset_id: Uuid::new_v4().to_string(),
        media_type: "text/plain".to_owned(),
    })
    .unwrap();
    let first_package = root.path().join("first.aigcproof");
    seal_signed_workspace(
        SealOptions {
            workspace: workspace.clone(),
            output: first_package.clone(),
            proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
            created_at: "2026-07-15T00:00:01Z".to_owned(),
        },
        &signer,
    )
    .unwrap();
    assert_eq!(
        verify_package_with_signer(
            &first_package,
            &VerificationLimits::default(),
            "2026-07-15T00:00:02Z".to_owned(),
            &signer,
        )
        .assurance
        .digital_signature,
        SignatureAssurance::ValidLocallyTrusted
    );

    let rotated = signer.rotate("AP-031 rotated credential test").unwrap();
    assert_eq!(rotated.state, LocalSignerState::Active);
    assert_ne!(rotated.key_fingerprint, created.key_fingerprint);
    assert_eq!(
        verify_package_with_signer(
            &first_package,
            &VerificationLimits::default(),
            "2026-07-15T00:00:03Z".to_owned(),
            &signer,
        )
        .assurance
        .digital_signature,
        SignatureAssurance::ValidUntrusted
    );
    let second_package = root.path().join("second.aigcproof");
    seal_signed_workspace(
        SealOptions {
            workspace,
            output: second_package.clone(),
            proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
            created_at: "2026-07-15T00:00:04Z".to_owned(),
        },
        &signer,
    )
    .unwrap();

    let disabled = signer.disable().unwrap();
    assert_eq!(disabled.state, LocalSignerState::Disabled);
    assert_eq!(signer.status(), disabled);
    assert_eq!(
        verify_package_with_signer(
            &second_package,
            &VerificationLimits::default(),
            "2026-07-15T00:00:05Z".to_owned(),
            &signer,
        )
        .assurance
        .digital_signature,
        SignatureAssurance::Disabled
    );
    signer.cleanup().unwrap();
    assert_eq!(signer.status().state, LocalSignerState::Missing);
}
