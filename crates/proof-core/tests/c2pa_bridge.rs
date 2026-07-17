use std::fs;
use std::io::ErrorKind;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use base64::Engine as _;
use c2pa::assertions::DigitalSourceType;
use c2pa::{Builder, BuilderIntent, Context, Ingredient, Signer as C2paSigner, SigningAlg};
use p256::ecdsa::signature::Signer as _;
use p256::ecdsa::{Signature, SigningKey};
use p256::pkcs8::DecodePrivateKey;
use proof_core::{
    AddAssetOptions, C2paHostSignRequest, C2paHostSigningCallback, C2paInspectOptions,
    C2paSigningAlgorithm, CreateC2paObservationOptions, InitWorkspaceOptions, add_asset,
    create_c2pa_observation, init_workspace, inspect_c2pa, load_workspace,
    parse_c2pa_trust_profile, sign_c2pa_with_host_callback,
};
use proof_schema::{AssetRole, C2PA_OBSERVATION_EVENT, C2PA_TRUST_PROFILE, C2paSourceMode};
use serde_json::json;
use tempfile::tempdir;

struct FixtureCallback {
    signing_key: SigningKey,
    certificates: Vec<Vec<u8>>,
    reserve_size: usize,
}

impl FixtureCallback {
    fn from_fixture_directory(fixtures: &Path) -> Self {
        let certificates_pem = fs::read_to_string(fixtures.join("certs/es256.pub")).unwrap();
        let certificates = certificates_pem
            .split("-----BEGIN CERTIFICATE-----")
            .skip(1)
            .map(|block| block.split("-----END CERTIFICATE-----").next().unwrap())
            .map(|body| {
                base64::engine::general_purpose::STANDARD
                    .decode(
                        body.chars()
                            .filter(|character| !character.is_whitespace())
                            .collect::<String>(),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let private_key_pem = fs::read_to_string(fixtures.join("certs/es256.pem")).unwrap();
        let private_key_der = private_key_pem
            .lines()
            .filter(|line| !line.starts_with("-----"))
            .collect::<String>();
        let private_key_der = base64::engine::general_purpose::STANDARD
            .decode(private_key_der)
            .unwrap();
        let signing_key = SigningKey::from_pkcs8_der(&private_key_der).unwrap();
        let reserve_size = 1024 + certificates.iter().map(Vec::len).sum::<usize>() + 10_000;
        Self {
            signing_key,
            certificates,
            reserve_size,
        }
    }
}

impl C2paHostSigningCallback for FixtureCallback {
    fn algorithm(&self) -> C2paSigningAlgorithm {
        C2paSigningAlgorithm::Es256
    }

    fn certificate_chain_der(&self) -> proof_core::CoreResult<Vec<Vec<u8>>> {
        Ok(self.certificates.clone())
    }

    fn reserve_size(&self) -> usize {
        self.reserve_size
    }

    fn sign(&self, request: C2paHostSignRequest<'_>) -> proof_core::CoreResult<Vec<u8>> {
        assert_eq!(request.algorithm, C2paSigningAlgorithm::Es256);
        assert_eq!(request.to_be_signed_sha256.len(), 64);
        let signature: Signature = self.signing_key.sign(request.to_be_signed);
        Ok(signature.to_vec())
    }
}

impl C2paSigner for FixtureCallback {
    fn sign(&self, data: &[u8]) -> c2pa::Result<Vec<u8>> {
        let signature: Signature = self.signing_key.sign(data);
        Ok(signature.to_vec())
    }

    fn alg(&self) -> SigningAlg {
        SigningAlg::Es256
    }

    fn certs(&self) -> c2pa::Result<Vec<Vec<u8>>> {
        Ok(self.certificates.clone())
    }

    fn reserve_size(&self) -> usize {
        self.reserve_size
    }
}

fn official_fixtures() -> Option<PathBuf> {
    std::env::var_os("AIGC_PROOF_C2PA_SDK_FIXTURES").map(PathBuf::from)
}

fn trust_profile_json(fixtures: &Path) -> String {
    let roots = fs::read_to_string(fixtures.join("certs/trust/test_cert_root_bundle.pem"))
        .unwrap()
        .replace("\r\n", "\n");
    let roots = roots
        .split("-----BEGIN CERTIFICATE-----")
        .skip(1)
        .map(|block| block.split("-----END CERTIFICATE-----").next().unwrap())
        .map(|body| format!("-----BEGIN CERTIFICATE-----{body}-----END CERTIFICATE-----\n"))
        .collect::<Vec<_>>();
    json!({
        "profile": C2PA_TRUST_PROFILE,
        "signer": {
            "source_label": "Pinned c2pa-rs 0.85.0 test signer roots",
            "trust_anchors_pem": roots.clone(),
            "allowed_ekus": [
                "1.3.6.1.5.5.7.3.4",
                "1.3.6.1.5.5.7.3.36",
                "1.3.6.1.4.1.62558.2.1"
            ],
            "effective_at": "2022-06-10T00:00:00Z",
            "expires_at": "2030-01-01T00:00:00Z"
        },
        "timestamp": {
            "source_label": "Pinned c2pa-rs 0.85.0 test timestamp roots",
            "trust_anchors_pem": roots,
            "allowed_ekus": ["1.3.6.1.5.5.7.3.8"],
            "effective_at": "2022-06-10T00:00:00Z",
            "expires_at": "2030-01-01T00:00:00Z"
        }
    })
    .to_string()
}

fn trust_profile(fixtures: &Path) -> proof_core::ParsedC2paTrustProfile {
    parse_c2pa_trust_profile(&trust_profile_json(fixtures)).unwrap()
}

fn sign_sidecar_fixture(
    source: &Path,
    media_type: &str,
    output: &Path,
    sidecar: &Path,
    callback: &FixtureCallback,
) {
    let context = Context::new()
        .with_settings(json!({
            "core": {"allowed_network_hosts": []},
            "verify": {"ocsp_fetch": false, "remote_manifest_fetch": false}
        }))
        .unwrap();
    let mut builder = Builder::from_context(context)
        .with_definition(json!({
            "claim_version": 2,
            "claim_generator_info": [{"name": "AIGC-Proof test sidecar", "version": "0.8.0"}]
        }))
        .unwrap();
    builder
        .set_intent(BuilderIntent::Create(
            DigitalSourceType::TrainedAlgorithmicMedia,
        ))
        .set_no_embed(true);
    let mut source = fs::File::open(source).unwrap();
    let mut destination = fs::File::create(output).unwrap();
    let manifest = builder
        .sign(callback, media_type, &mut source, &mut destination)
        .unwrap();
    fs::write(sidecar, manifest).unwrap();
}

#[test]
fn pinned_official_v1_fixture_is_read_only_compatible() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let inspection = inspect_c2pa(C2paInspectOptions {
        asset_path: fixtures.join("C.jpg"),
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap();
    assert_eq!(inspection.claim_version, 1);
    assert_eq!(inspection.source_mode, C2paSourceMode::Embedded);
    assert_eq!(inspection.asset_sha256.len(), 64);
    assert_eq!(inspection.manifest_store_sha256.len(), 64);
}

#[test]
fn host_callback_signs_and_bridge_reads_claim_v2_for_all_supported_images() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();
    let output_directory = temporary.path();
    let evidence_directory = std::env::var_os("AIGC_PROOF_C2PA_OUTPUT_DIR").map(PathBuf::from);
    if let Some(evidence_directory) = evidence_directory.as_ref() {
        fs::create_dir_all(evidence_directory).unwrap();
        fs::write(
            evidence_directory.join("trust-profile.json"),
            trust_profile_json(&fixtures),
        )
        .unwrap();
    }
    for (input, output) in [
        ("no_manifest.jpg", "embedded-v2.jpg"),
        ("sample1.png", "embedded-v2.png"),
        ("sample1.webp", "embedded-v2.webp"),
    ] {
        let output = output_directory.join(output);
        sign_c2pa_with_host_callback(&fixtures.join(input), &output, &callback).unwrap();
        let inspection = inspect_c2pa(C2paInspectOptions {
            asset_path: output.clone(),
            sidecar_path: None,
            trust_profile: Some(&profile),
            observed_at: "2026-07-15T00:00:00Z".to_owned(),
        })
        .unwrap();
        assert_eq!(inspection.claim_version, 2, "{input}");
        assert_eq!(inspection.source_mode, C2paSourceMode::Embedded, "{input}");
        assert!(inspection.elapsed_ms <= 30_000, "{input}");
        if let Some(evidence_directory) = evidence_directory.as_ref() {
            fs::copy(
                &output,
                evidence_directory.join(output.file_name().unwrap()),
            )
            .unwrap();
        }
        let extension = Path::new(input)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap();
        sign_sidecar_fixture(
            &fixtures.join(input),
            inspection_media_type(extension),
            &output_directory.join(format!("sidecar-source.{extension}")),
            &output_directory.join(format!("explicit-v2-{extension}.c2pa")),
            &callback,
        );
        if let Some(evidence_directory) = evidence_directory.as_ref() {
            fs::copy(
                output_directory.join(format!("sidecar-source.{extension}")),
                evidence_directory.join(format!("sidecar-source.{extension}")),
            )
            .unwrap();
            fs::copy(
                output_directory.join(format!("explicit-v2-{extension}.c2pa")),
                evidence_directory.join(format!("explicit-v2-{extension}.c2pa")),
            )
            .unwrap();
        }
        let no_clobber =
            sign_c2pa_with_host_callback(&fixtures.join(input), &output, &callback).unwrap_err();
        assert_eq!(no_clobber.code, "C2PA_OUTPUT_ALREADY_EXISTS");
    }
    if let Some(evidence_directory) = evidence_directory {
        fs::copy(
            fixtures.join("libpng-test_with_url.png"),
            evidence_directory.join("remote-reference.png"),
        )
        .unwrap();
        fs::copy(
            fixtures.join("basic.pdf"),
            evidence_directory.join("unsupported.pdf"),
        )
        .unwrap();
    }
}

#[test]
fn trustless_inspection_is_offline_valid_untrusted_without_snapshot_digests() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();
    let signed = temporary.path().join("trustless.png");
    sign_c2pa_with_host_callback(&fixtures.join("sample1.png"), &signed, &callback).unwrap();

    let inspection = inspect_c2pa(C2paInspectOptions {
        asset_path: signed,
        sidecar_path: None,
        trust_profile: None,
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap();

    assert_eq!(
        inspection.validation_state,
        proof_schema::C2paValidationState::ValidUntrusted
    );
    assert_eq!(
        inspection.signer_trust,
        proof_schema::C2paTrustState::NotEvaluated
    );
    assert_eq!(
        inspection.timestamp_trust,
        proof_schema::C2paTrustState::NotEvaluated
    );
    assert!(inspection.signer_trust_snapshot_sha256.is_none());
    assert!(inspection.timestamp_trust_snapshot_sha256.is_none());
    let encoded = serde_json::to_value(inspection).unwrap();
    assert!(encoded.get("signer_trust_snapshot_sha256").is_none());
    assert!(encoded.get("timestamp_trust_snapshot_sha256").is_none());
}

#[test]
fn expired_and_malformed_profiles_fail_before_media_trust_evaluation() {
    assert_eq!(
        parse_c2pa_trust_profile("{not-json").unwrap_err().code,
        "C2PA_TRUST_PROFILE_JSON_INVALID"
    );
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let mut expired: serde_json::Value =
        serde_json::from_str(&trust_profile_json(&fixtures)).unwrap();
    expired["signer"]["expires_at"] = json!("2026-07-14T00:00:00Z");
    expired["timestamp"]["expires_at"] = json!("2026-07-14T00:00:00Z");
    let expired = parse_c2pa_trust_profile(&serde_json::to_string(&expired).unwrap()).unwrap();
    let error = inspect_c2pa(C2paInspectOptions {
        asset_path: fixtures.join("C.jpg"),
        sidecar_path: None,
        trust_profile: Some(&expired),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(error.code, "C2PA_TRUST_SNAPSHOT_NOT_EFFECTIVE");
}

#[test]
fn wrong_purpose_profile_is_rejected_before_media_trust_evaluation() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let mut wrong_purpose: serde_json::Value =
        serde_json::from_str(&trust_profile_json(&fixtures)).unwrap();
    wrong_purpose["signer"]["allowed_ekus"] = json!(["1.3.6.1.5.5.7.3.8"]);
    assert_eq!(
        parse_c2pa_trust_profile(&serde_json::to_string(&wrong_purpose).unwrap())
            .unwrap_err()
            .code,
        "C2PA_TRUST_PROFILE_PURPOSE_INVALID"
    );
}

fn inspection_media_type(extension: &str) -> &'static str {
    match extension {
        "jpg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => unreachable!(),
    }
}

#[test]
fn explicit_local_sidecar_is_digest_bound_and_remote_lookup_is_not_used() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();
    let clean = fixtures.join("sample1.png");
    let sidecar_asset = temporary.path().join("sidecar-source.png");
    let sidecar = temporary.path().join("manifest.c2pa");
    sign_sidecar_fixture(&clean, "image/png", &sidecar_asset, &sidecar, &callback);
    if let Some(output_directory) = std::env::var_os("AIGC_PROOF_C2PA_OUTPUT_DIR") {
        let output_directory = PathBuf::from(output_directory);
        fs::create_dir_all(&output_directory).unwrap();
        fs::copy(&clean, output_directory.join("sidecar-source.png")).unwrap();
        fs::copy(&sidecar, output_directory.join("explicit.c2pa")).unwrap();
    }
    let inspection = inspect_c2pa(C2paInspectOptions {
        asset_path: sidecar_asset,
        sidecar_path: Some(sidecar),
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap();
    assert_eq!(inspection.claim_version, 2);
    assert_eq!(inspection.source_mode, C2paSourceMode::Sidecar);
    assert_ne!(
        inspection.validation_state,
        proof_schema::C2paValidationState::Invalid
    );
}

#[test]
fn workspace_observation_is_bound_to_the_recorded_asset_digest() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();
    let signed = temporary.path().join("signed.jpg");
    sign_c2pa_with_host_callback(&fixtures.join("no_manifest.jpg"), &signed, &callback).unwrap();
    let workspace = temporary.path().join("workspace");
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: Some("C2PA observation fixture".to_owned()),
        created_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap();
    let asset = add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source: signed,
        role: AssetRole::Output,
        asset_id: "00000000-0000-4000-8000-000000000033".to_owned(),
        media_type: "image/jpeg".to_owned(),
    })
    .unwrap();
    let event = create_c2pa_observation(CreateC2paObservationOptions {
        workspace: workspace.clone(),
        asset_id: asset.asset_id.clone(),
        sidecar_path: None,
        trust_profile: &profile,
        event_id: "00000000-0000-4000-8000-000000000034".to_owned(),
        created_at: "2026-07-15T00:00:01Z".to_owned(),
    })
    .unwrap();
    assert_eq!(event.event_type, C2PA_OBSERVATION_EVENT);
    assert_eq!(event.payload["asset_id"], asset.asset_id);
    assert_eq!(event.payload["asset_sha256"], asset.sha256);
    assert_eq!(load_workspace(&workspace).unwrap().assets.len(), 1);
}

#[test]
fn remote_reference_and_unsupported_media_fail_closed() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let listener = TcpListener::bind("127.0.0.1:5000")
        .expect("the official remote-reference fixture port must be available");
    listener.set_nonblocking(true).unwrap();
    let remote = inspect_c2pa(C2paInspectOptions {
        asset_path: fixtures.join("libpng-test_with_url.png"),
        sidecar_path: None,
        trust_profile: None,
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(remote.code, "C2PA_MANIFEST_NOT_FOUND");
    thread::sleep(Duration::from_millis(100));
    let connection = listener.accept().unwrap_err();
    assert_eq!(
        connection.kind(),
        ErrorKind::WouldBlock,
        "offline C2PA inspection opened a socket for a remote manifest"
    );
    let unsupported = inspect_c2pa(C2paInspectOptions {
        asset_path: fixtures.join("basic.pdf"),
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(unsupported.code, "IMAGE_TYPE_UNSUPPORTED");
}

#[test]
fn tampering_is_normalized_without_copying_assertion_text() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();
    let signed = temporary.path().join("tampered.jpg");
    sign_c2pa_with_host_callback(&fixtures.join("no_manifest.jpg"), &signed, &callback).unwrap();
    let mut bytes = fs::read(&signed).unwrap();
    bytes.push(0);
    fs::write(&signed, bytes).unwrap();
    if let Some(output_directory) = std::env::var_os("AIGC_PROOF_C2PA_OUTPUT_DIR") {
        let output_directory = PathBuf::from(output_directory);
        fs::create_dir_all(&output_directory).unwrap();
        fs::copy(&signed, output_directory.join("tampered.jpg")).unwrap();
    }
    let inspection = inspect_c2pa(C2paInspectOptions {
        asset_path: signed,
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap();
    assert_eq!(
        inspection.validation_state,
        proof_schema::C2paValidationState::Invalid
    );
    assert!(
        inspection
            .failure_codes
            .iter()
            .any(|code| code == "assertion.dataHash.mismatch")
    );
    assert!(
        inspection
            .failure_codes
            .iter()
            .all(|code| !code.contains('<') && !code.contains('>'))
    );
}

#[test]
fn soft_binding_assertion_is_explicitly_unsupported() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();
    let output = temporary.path().join("soft-binding.jpg");
    let context = Context::new()
        .with_settings(json!({
            "core": {"allowed_network_hosts": []},
            "verify": {"ocsp_fetch": false, "remote_manifest_fetch": false}
        }))
        .unwrap();
    let mut builder = Builder::from_context(context)
        .with_definition(json!({"claim_version": 2}))
        .unwrap();
    builder.set_intent(BuilderIntent::Create(
        DigitalSourceType::TrainedAlgorithmicMedia,
    ));
    builder
        .add_assertion(
            "c2pa.soft-binding",
            &json!({"alg": "test-only", "blocks": []}),
        )
        .unwrap();
    let mut source = fs::File::open(fixtures.join("no_manifest.jpg")).unwrap();
    let mut destination = fs::File::create(&output).unwrap();
    builder
        .sign(&callback, "image/jpeg", &mut source, &mut destination)
        .unwrap();
    drop(destination);
    if let Some(output_directory) = std::env::var_os("AIGC_PROOF_C2PA_OUTPUT_DIR") {
        let output_directory = PathBuf::from(output_directory);
        fs::create_dir_all(&output_directory).unwrap();
        fs::copy(&output, output_directory.join("soft-binding.jpg")).unwrap();
    }
    let error = inspect_c2pa(C2paInspectOptions {
        asset_path: output,
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(error.code, "C2PA_SOFT_BINDING_UNSUPPORTED");
}

#[test]
fn pinned_official_attack_corpus_is_bounded_and_does_not_escape_status_fields() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let Some(corpus) = std::env::var_os("AIGC_PROOF_C2PA_ATTACK_CORPUS") else {
        eprintln!("skipped: AIGC_PROOF_C2PA_ATTACK_CORPUS is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let mut assets = fs::read_dir(corpus)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("jpg"))
        .collect::<Vec<_>>();
    assets.sort();
    assert_eq!(
        assets.len(),
        32,
        "the pinned attack corpus changed unexpectedly"
    );

    for asset in assets {
        let inspection = inspect_c2pa(C2paInspectOptions {
            asset_path: asset.clone(),
            sidecar_path: None,
            trust_profile: Some(&profile),
            observed_at: "2026-07-15T00:00:00Z".to_owned(),
        })
        .unwrap_or_else(|error| panic!("{}: {error}", asset.display()));
        let report = serde_json::to_string(&inspection).unwrap();
        assert!(
            report.len() < 16 * 1024,
            "{} produced an unbounded report",
            asset.display()
        );
        assert!(
            !report.contains('<')
                && !report.contains('>')
                && !report.to_ascii_lowercase().contains("javascript:")
                && !report.to_ascii_lowercase().contains("drop table"),
            "{} leaked an injected manifest field into the normalized report",
            asset.display()
        );
        assert!(inspection.elapsed_ms <= 30_000);
        assert!(
            inspection
                .success_codes
                .iter()
                .chain(&inspection.informational_codes)
                .chain(&inspection.failure_codes)
                .all(|code| code.len() <= 128 && code.is_ascii())
        );
    }
}

#[test]
fn assertion_and_ingredient_count_limits_reject_real_signed_media() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();

    let assertion_output = temporary.path().join("assertion-limit.jpg");
    let mut assertion_builder = Builder::default();
    assertion_builder.set_intent(BuilderIntent::Create(
        DigitalSourceType::TrainedAlgorithmicMedia,
    ));
    for index in 0..=1024 {
        assertion_builder
            .add_assertion("com.aigc-proof.limit", &json!({"index": index}))
            .unwrap();
    }
    let mut source = fs::File::open(fixtures.join("no_manifest.jpg")).unwrap();
    let mut destination = fs::File::create(&assertion_output).unwrap();
    assertion_builder
        .sign(&callback, "image/jpeg", &mut source, &mut destination)
        .unwrap();
    drop(destination);
    let assertion_error = inspect_c2pa(C2paInspectOptions {
        asset_path: assertion_output.clone(),
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(assertion_error.code, "C2PA_ASSERTION_LIMIT_EXCEEDED");

    let ingredient_output = temporary.path().join("ingredient-limit.jpg");
    let mut ingredient_builder = Builder::default();
    ingredient_builder.set_intent(BuilderIntent::Create(
        DigitalSourceType::TrainedAlgorithmicMedia,
    ));
    for index in 0..=256 {
        let ingredient = Ingredient::from_json(
            &json!({
                "title": format!("ingredient-{index}.jpg"),
                "format": "image/jpeg",
                "instance_id": format!("xmp:iid:00000000-0000-4000-8000-{index:012}"),
                "relationship": "componentOf"
            })
            .to_string(),
        )
        .unwrap();
        ingredient_builder.add_ingredient(ingredient);
    }
    let mut source = fs::File::open(fixtures.join("no_manifest.jpg")).unwrap();
    let mut destination = fs::File::create(&ingredient_output).unwrap();
    ingredient_builder
        .sign(&callback, "image/jpeg", &mut source, &mut destination)
        .unwrap();
    drop(destination);
    let ingredient_error = inspect_c2pa(C2paInspectOptions {
        asset_path: ingredient_output.clone(),
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(ingredient_error.code, "C2PA_INGREDIENT_LIMIT_EXCEEDED");

    if let Some(output_directory) = std::env::var_os("AIGC_PROOF_C2PA_OUTPUT_DIR") {
        let output_directory = PathBuf::from(output_directory);
        fs::create_dir_all(&output_directory).unwrap();
        fs::copy(
            assertion_output,
            output_directory.join("assertion-limit.jpg"),
        )
        .unwrap();
        fs::copy(
            ingredient_output,
            output_directory.join("ingredient-limit.jpg"),
        )
        .unwrap();
    }
}

#[test]
fn malformed_jumbf_media_and_byte_limits_fail_closed() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let temporary = tempdir().unwrap();

    let malformed_sidecar = temporary.path().join("malformed.c2pa");
    fs::write(&malformed_sidecar, b"not-a-jumbf-manifest-store").unwrap();
    let malformed = inspect_c2pa(C2paInspectOptions {
        asset_path: fixtures.join("no_manifest.jpg"),
        sidecar_path: Some(malformed_sidecar),
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(malformed.code, "C2PA_VALIDATION_REJECTED");

    let zip_disguised_as_image = temporary.path().join("archive.jpg");
    fs::write(&zip_disguised_as_image, b"PK\x03\x04not-an-image").unwrap();
    let media = inspect_c2pa(C2paInspectOptions {
        asset_path: zip_disguised_as_image,
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(media.code, "IMAGE_TYPE_UNSUPPORTED");

    let oversized_asset = temporary.path().join("oversized.jpg");
    fs::File::create(&oversized_asset)
        .unwrap()
        .set_len(128 * 1024 * 1024 + 1)
        .unwrap();
    let asset_limit = inspect_c2pa(C2paInspectOptions {
        asset_path: oversized_asset,
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(asset_limit.code, "C2PA_INPUT_LIMIT_EXCEEDED");

    let oversized_sidecar = temporary.path().join("oversized.c2pa");
    fs::File::create(&oversized_sidecar)
        .unwrap()
        .set_len(32 * 1024 * 1024 + 1)
        .unwrap();
    let sidecar_limit = inspect_c2pa(C2paInspectOptions {
        asset_path: fixtures.join("no_manifest.jpg"),
        sidecar_path: Some(oversized_sidecar),
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(sidecar_limit.code, "C2PA_INPUT_LIMIT_EXCEEDED");
}

#[test]
fn future_claim_version_is_not_inferred_as_c2pa_2_2() {
    let Some(fixtures) = official_fixtures() else {
        eprintln!("skipped: AIGC_PROOF_C2PA_SDK_FIXTURES is not configured");
        return;
    };
    let profile = trust_profile(&fixtures);
    let callback = FixtureCallback::from_fixture_directory(&fixtures);
    let temporary = tempdir().unwrap();
    let output = temporary.path().join("future-claim.jpg");
    let mut builder = Builder::default()
        .with_definition(json!({"claim_version": 3}))
        .unwrap();
    builder.set_intent(BuilderIntent::Create(
        DigitalSourceType::TrainedAlgorithmicMedia,
    ));
    let mut source = fs::File::open(fixtures.join("no_manifest.jpg")).unwrap();
    let mut destination = fs::File::create(&output).unwrap();
    builder
        .sign(&callback, "image/jpeg", &mut source, &mut destination)
        .unwrap();
    drop(destination);
    let error = inspect_c2pa(C2paInspectOptions {
        asset_path: output.clone(),
        sidecar_path: None,
        trust_profile: Some(&profile),
        observed_at: "2026-07-15T00:00:00Z".to_owned(),
    })
    .unwrap_err();
    assert_eq!(error.code, "C2PA_CLAIM_VERSION_UNSUPPORTED");
    if let Some(output_directory) = std::env::var_os("AIGC_PROOF_C2PA_OUTPUT_DIR") {
        let output_directory = PathBuf::from(output_directory);
        fs::create_dir_all(&output_directory).unwrap();
        fs::copy(output, output_directory.join("future-claim.jpg")).unwrap();
    }
}
