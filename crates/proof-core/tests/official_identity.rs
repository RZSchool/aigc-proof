use base64::{Engine as _, engine::general_purpose::STANDARD};
use coset::{CoseSign1Builder, HeaderBuilder, TaggedCborSerializable, iana};
use ed25519_dalek::{Signer, SigningKey};
use proof_core::{OfficialIdentityVerifyOptions, canonical_json, verify_official_identity};
use proof_schema::{
    OFFICIAL_ATTESTATION_AAD, OFFICIAL_ATTESTATION_PROFILE, OFFICIAL_STATUS_AAD,
    OFFICIAL_STATUS_PROFILE, OFFICIAL_TRUST_PROFILE, OfficialAttestation, OfficialAttestedSubject,
    OfficialConsentClaim, OfficialIdentityAssurance, OfficialIssuerTrustSnapshot,
    OfficialMethodClass, OfficialStatusEntry, OfficialStatusSnapshot, OfficialSubjectType,
};
use uuid::Uuid;

const NOW: i64 = 1_800_000_000;
const FINGERPRINT: &str = "sha256:630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd";

fn signed<T: serde::Serialize>(value: &T, key: &SigningKey, kid: &[u8], aad: &[u8]) -> Vec<u8> {
    let payload = canonical_json(value).unwrap();
    let protected = HeaderBuilder::new()
        .algorithm(iana::Algorithm::EdDSA)
        .key_id(kid.to_vec())
        .build();
    let mut sign1 = CoseSign1Builder::new()
        .protected(protected)
        .payload(payload)
        .build();
    sign1.signature = key.sign(&sign1.tbs_data(aad)).to_bytes().to_vec();
    sign1.to_tagged_vec().unwrap()
}

fn valid_fixture() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let key = SigningKey::from_bytes(&[42; 32]);
    let kid = b"independent-ap035-key";
    let attestation_id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440035").unwrap();
    let attestation = OfficialAttestation {
        profile: OFFICIAL_ATTESTATION_PROFILE.to_owned(),
        issuer: "urn:aigc-proof:official:independent-ap035".to_owned(),
        attestation_id,
        subject: OfficialAttestedSubject {
            opaque_id: "synthetic-subject-ap035".to_owned(),
            subject_type: OfficialSubjectType::Person,
            display_claim: "Independent Synthetic Person".to_owned(),
        },
        creator_key_fingerprint: FINGERPRINT.to_owned(),
        method_class: OfficialMethodClass::SyntheticTest,
        purpose: "creator_identity".to_owned(),
        consent: OfficialConsentClaim {
            consent_id: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440036").unwrap(),
            recorded_at: NOW - 100,
            purpose: "creator_identity".to_owned(),
        },
        issued_at: NOW - 60,
        expires_at: NOW + 3600,
        status_endpoint_class: "offline_snapshot".to_owned(),
    };
    let status = OfficialStatusSnapshot {
        profile: OFFICIAL_STATUS_PROFILE.to_owned(),
        issuer: attestation.issuer.clone(),
        sequence: 7,
        effective_at: NOW - 30,
        generated_at: NOW - 30,
        previous_digest: Some(format!("sha256:{}", "a".repeat(64))),
        entries: vec![OfficialStatusEntry {
            attestation_id,
            status: "valid".to_owned(),
            effective_at: NOW - 30,
        }],
    };
    let trust = OfficialIssuerTrustSnapshot {
        profile: OFFICIAL_TRUST_PROFILE.to_owned(),
        issuer: attestation.issuer.clone(),
        sequence: 4,
        key_id: String::from_utf8(kid.to_vec()).unwrap(),
        algorithm: "Ed25519".to_owned(),
        public_key_b64: STANDARD.encode(key.verifying_key().to_bytes()),
        valid_from: NOW - 3600,
        valid_until: NOW + 7200,
        status: "active".to_owned(),
    };
    (
        signed(&attestation, &key, kid, OFFICIAL_ATTESTATION_AAD),
        canonical_json(&trust).unwrap(),
        signed(&status, &key, kid, OFFICIAL_STATUS_AAD),
    )
}

#[test]
fn independent_positive_and_negative_corpus_exercises_all_bindings() {
    let (attestation, trust, status) = valid_fixture();
    assert_eq!(
        attestation,
        STANDARD
            .decode(
                include_str!(
                    "../../../tests/vectors/official-identity/independent-attestation.cose.b64"
                )
                .trim()
            )
            .unwrap()
    );
    assert_eq!(
        String::from_utf8(trust.clone()).unwrap(),
        include_str!("../../../tests/vectors/official-identity/independent-trust.json").trim()
    );
    assert_eq!(
        status,
        STANDARD
            .decode(
                include_str!(
                    "../../../tests/vectors/official-identity/independent-status.cose.b64"
                )
                .trim()
            )
            .unwrap()
    );
    let options = || {
        OfficialIdentityVerifyOptions::strict(
            &attestation,
            &trust,
            Some(&status),
            &FINGERPRINT[7..],
            "creator_identity",
            NOW,
        )
    };
    let verified = verify_official_identity(options());
    assert_eq!(verified.state, OfficialIdentityAssurance::ValidTrusted);
    assert_eq!(verified.trust_sequence, 4);
    assert_eq!(verified.status_sequence, Some(7));

    let mut missing = options();
    missing.status_cose = None;
    assert_eq!(
        verify_official_identity(missing).state,
        OfficialIdentityAssurance::Indeterminate
    );

    let mut key_substitution = options();
    key_substitution.expected_creator_key_fingerprint =
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assert_eq!(
        verify_official_identity(key_substitution).code,
        "OFFICIAL_CREATOR_KEY_MISMATCH"
    );

    let mut purpose_substitution = options();
    purpose_substitution.expected_purpose = "rights_owner";
    assert_eq!(
        verify_official_identity(purpose_substitution).code,
        "OFFICIAL_PURPOSE_CONSENT_MISMATCH"
    );

    let mut rollback = options();
    rollback.minimum_status_sequence = 8;
    assert_eq!(
        verify_official_identity(rollback).code,
        "OFFICIAL_STATUS_ROLLBACK"
    );

    let mut fork = options();
    fork.expected_previous_status_digest =
        Some("sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert_eq!(verify_official_identity(fork).code, "OFFICIAL_STATUS_FORK");

    let mut stale = options();
    stale.max_status_age_seconds = 1;
    assert_eq!(
        verify_official_identity(stale).code,
        "OFFICIAL_STATUS_STALE"
    );

    let mut changed = attestation.clone();
    let index = changed.len() - 1;
    changed[index] ^= 1;
    let invalid = verify_official_identity(OfficialIdentityVerifyOptions::strict(
        &changed,
        &trust,
        Some(&status),
        FINGERPRINT,
        "creator_identity",
        NOW,
    ));
    assert_ne!(invalid.state, OfficialIdentityAssurance::ValidTrusted);
}

#[test]
fn exact_synthetic_ap034_producer_fixture_verifies_and_reports_revocation() {
    let attestation = STANDARD
        .decode(
            include_str!("../../../tests/vectors/official-identity/ap034-attestation.cose.b64")
                .trim(),
        )
        .unwrap();
    let status = STANDARD
        .decode(
            include_str!("../../../tests/vectors/official-identity/ap034-status.cose.b64").trim(),
        )
        .unwrap();
    let trust = include_bytes!("../../../tests/vectors/official-identity/ap034-trust.json");
    let report = verify_official_identity(OfficialIdentityVerifyOptions::strict(
        &attestation,
        trust,
        Some(&status),
        "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd",
        "creator_identity",
        1_784_173_500,
    ));
    assert_eq!(report.state, OfficialIdentityAssurance::Revoked);
    assert_eq!(report.code, "OFFICIAL_ATTESTATION_REVOKED");
    assert_eq!(
        report.attestation_sha256,
        "sha256:fd65499e50c47b10436ad5babd8b436ff57fe919a6d2301046d29550d5e8cf74"
    );
    assert_eq!(
        report.status_sha256.as_deref(),
        Some("sha256:def761b49f121a7eeb50a9d661c9d979d9f8c35c832a1b49b785c4e15b659a5f")
    );
}

#[test]
fn unknown_trust_member_and_unsigned_status_are_rejected() {
    let (attestation, trust, status) = valid_fixture();
    let mut trust_value: serde_json::Value = serde_json::from_slice(&trust).unwrap();
    trust_value["moving_latest"] = serde_json::json!(true);
    let report = verify_official_identity(OfficialIdentityVerifyOptions::strict(
        &attestation,
        &serde_json::to_vec(&trust_value).unwrap(),
        Some(&status),
        FINGERPRINT,
        "creator_identity",
        NOW,
    ));
    assert_eq!(report.code, "OFFICIAL_SCHEMA_INVALID");

    let mut future_trust: serde_json::Value = serde_json::from_slice(&trust).unwrap();
    future_trust["profile"] = serde_json::json!("aigc-proof.official-issuer-trust.v2");
    let future_report = verify_official_identity(OfficialIdentityVerifyOptions::strict(
        &attestation,
        &serde_json::to_vec(&future_trust).unwrap(),
        Some(&status),
        FINGERPRINT,
        "creator_identity",
        NOW,
    ));
    assert_eq!(future_report.state, OfficialIdentityAssurance::Unsupported);
    assert_eq!(future_report.code, "OFFICIAL_TRUST_POLICY_UNSUPPORTED");

    let unsigned = br#"{"profile":"aigc-proof.official-status-snapshot.v1"}"#;
    let report = verify_official_identity(OfficialIdentityVerifyOptions::strict(
        &attestation,
        &trust,
        Some(unsigned),
        FINGERPRINT,
        "creator_identity",
        NOW,
    ));
    assert_eq!(report.state, OfficialIdentityAssurance::Malformed);
}
