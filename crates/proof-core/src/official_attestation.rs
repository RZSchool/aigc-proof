use base64::{Engine as _, engine::general_purpose::STANDARD};
use coset::{
    CborSerializable, CoseSign1, RegisteredLabelWithPrivate, TaggedCborSerializable, iana,
};
use ed25519_dalek::{Signature, VerifyingKey};
use proof_schema::{
    OFFICIAL_ATTESTATION_AAD, OFFICIAL_ATTESTATION_PROFILE, OFFICIAL_STATUS_AAD,
    OFFICIAL_STATUS_PROFILE, OFFICIAL_TRUST_PROFILE, OfficialAttestation,
    OfficialIdentityAssurance, OfficialIdentityVerification, OfficialIssuerTrustSnapshot,
    OfficialStatusSnapshot, parse_json_strict, validate_official_attestation_schema,
    validate_official_status_schema, validate_official_trust_schema,
};
use serde::de::DeserializeOwned;

use crate::{canonical_json, sha256_bytes};

pub const OFFICIAL_MAX_JSON_BYTES: usize = 64 * 1024;
pub const OFFICIAL_MAX_COSE_BYTES: usize = 64 * 1024;
pub const OFFICIAL_MAX_STATUS_ENTRIES: usize = 10_000;
pub const OFFICIAL_DEFAULT_MAX_STATUS_AGE_SECONDS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone)]
pub struct OfficialIdentityVerifyOptions<'a> {
    pub attestation_cose: &'a [u8],
    pub issuer_trust_json: &'a [u8],
    pub status_cose: Option<&'a [u8]>,
    pub expected_creator_key_fingerprint: &'a str,
    pub expected_purpose: &'a str,
    pub verification_time: i64,
    pub minimum_trust_sequence: i64,
    pub minimum_status_sequence: i64,
    pub expected_previous_status_digest: Option<&'a str>,
    pub max_status_age_seconds: i64,
}

impl<'a> OfficialIdentityVerifyOptions<'a> {
    pub fn strict(
        attestation_cose: &'a [u8],
        issuer_trust_json: &'a [u8],
        status_cose: Option<&'a [u8]>,
        expected_creator_key_fingerprint: &'a str,
        expected_purpose: &'a str,
        verification_time: i64,
    ) -> Self {
        Self {
            attestation_cose,
            issuer_trust_json,
            status_cose,
            expected_creator_key_fingerprint,
            expected_purpose,
            verification_time,
            minimum_trust_sequence: 1,
            minimum_status_sequence: 1,
            expected_previous_status_digest: None,
            max_status_age_seconds: OFFICIAL_DEFAULT_MAX_STATUS_AGE_SECONDS,
        }
    }
}

pub fn verify_official_identity(
    options: OfficialIdentityVerifyOptions<'_>,
) -> OfficialIdentityVerification {
    let attestation_digest = prefixed_digest(options.attestation_cose);
    let issuer_trust_digest = prefixed_digest(options.issuer_trust_json);
    let mut report = empty_report(attestation_digest, issuer_trust_digest);

    if let Ok(candidate) = parse_json_strict::<serde_json::Value>(options.issuer_trust_json) {
        let profile = candidate.get("profile").and_then(serde_json::Value::as_str);
        let algorithm = candidate
            .get("algorithm")
            .and_then(serde_json::Value::as_str);
        if matches!(profile, Some(value) if value != OFFICIAL_TRUST_PROFILE)
            || matches!(algorithm, Some(value) if value != "Ed25519")
        {
            return failed(
                report,
                OfficialIdentityAssurance::Unsupported,
                "OFFICIAL_TRUST_POLICY_UNSUPPORTED",
                "Issuer trust snapshot profile or algorithm is not supported by this verifier.",
            );
        }
    }

    let trust: OfficialIssuerTrustSnapshot = match parse_profile(
        options.issuer_trust_json,
        validate_official_trust_schema,
        "OFFICIAL_TRUST",
    ) {
        Ok(value) => value,
        Err((state, code, message)) => return failed(report, state, code, message),
    };
    report.trust_sequence = trust.sequence;
    if trust.profile != OFFICIAL_TRUST_PROFILE
        || trust.algorithm != "Ed25519"
        || trust.sequence < options.minimum_trust_sequence
        || trust.valid_from < 0
        || trust.valid_until <= trust.valid_from
    {
        return failed(
            report,
            OfficialIdentityAssurance::Unsupported,
            "OFFICIAL_TRUST_POLICY_UNSUPPORTED",
            "Issuer trust snapshot profile, algorithm, sequence, or validity policy is unsupported.",
        );
    }
    if trust.status == "revoked" {
        return failed(
            report,
            OfficialIdentityAssurance::Untrusted,
            "OFFICIAL_ISSUER_KEY_REVOKED",
            "The explicitly imported issuer key is revoked.",
        );
    }
    if !matches!(trust.status.as_str(), "active" | "retired") {
        return failed(
            report,
            OfficialIdentityAssurance::Untrusted,
            "OFFICIAL_ISSUER_KEY_UNTRUSTED",
            "The explicitly imported issuer key is not trusted for verification.",
        );
    }
    let public_key = match decode_public_key(&trust.public_key_b64) {
        Ok(value) => value,
        Err(message) => {
            return failed(
                report,
                OfficialIdentityAssurance::Malformed,
                "OFFICIAL_TRUST_KEY_MALFORMED",
                message,
            );
        }
    };

    let attestation: OfficialAttestation = match verify_cose_payload(
        options.attestation_cose,
        trust.key_id.as_bytes(),
        OFFICIAL_ATTESTATION_AAD,
        &public_key,
        validate_official_attestation_schema,
        "OFFICIAL_ATTESTATION",
    ) {
        Ok(value) => value,
        Err((state, code, message)) => return failed(report, state, code, message),
    };
    populate_attestation(&mut report, &attestation);

    if attestation.profile != OFFICIAL_ATTESTATION_PROFILE
        || attestation.status_endpoint_class != "offline_snapshot"
    {
        return failed(
            report,
            OfficialIdentityAssurance::Unsupported,
            "OFFICIAL_ATTESTATION_PROFILE_UNSUPPORTED",
            "Official attestation profile is unsupported.",
        );
    }
    if attestation.issuer != trust.issuer {
        return failed(
            report,
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_ISSUER_SUBSTITUTION",
            "Attestation issuer does not match the explicit trust snapshot.",
        );
    }
    if attestation.creator_key_fingerprint
        != normalize_fingerprint(options.expected_creator_key_fingerprint)
    {
        return failed(
            report,
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_CREATOR_KEY_MISMATCH",
            "Attestation does not bind the expected creator public-key fingerprint.",
        );
    }
    if attestation.purpose != options.expected_purpose
        || attestation.consent.purpose != attestation.purpose
        || attestation.consent.recorded_at > attestation.issued_at
    {
        return failed(
            report,
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_PURPOSE_CONSENT_MISMATCH",
            "Attestation purpose and consent binding do not match the requested purpose.",
        );
    }
    if attestation.issued_at < 0
        || attestation.expires_at <= attestation.issued_at
        || attestation.issued_at < trust.valid_from
        || attestation.issued_at >= trust.valid_until
    {
        return failed(
            report,
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_ISSUANCE_TIME_INVALID",
            "Attestation issue time is outside the attestation or issuer-key validity interval.",
        );
    }
    if options.verification_time >= attestation.expires_at {
        return failed(
            report,
            OfficialIdentityAssurance::Expired,
            "OFFICIAL_ATTESTATION_EXPIRED",
            "Official attestation is expired at the explicit verification time.",
        );
    }
    if options.verification_time < attestation.issued_at {
        return failed(
            report,
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_ATTESTATION_NOT_YET_VALID",
            "Official attestation was issued after the explicit verification time.",
        );
    }
    if options.verification_time < trust.valid_from
        || options.verification_time >= trust.valid_until
    {
        return failed(
            report,
            OfficialIdentityAssurance::Untrusted,
            "OFFICIAL_TRUST_SNAPSHOT_EXPIRED",
            "Issuer trust snapshot is not valid at the explicit verification time.",
        );
    }

    let Some(status_cose) = options.status_cose else {
        return failed(
            report,
            OfficialIdentityAssurance::Indeterminate,
            "OFFICIAL_STATUS_SNAPSHOT_ABSENT",
            "A current signed status snapshot is required for trusted official identity assurance.",
        );
    };
    report.status_sha256 = Some(prefixed_digest(status_cose));
    let status: OfficialStatusSnapshot = match verify_cose_payload(
        status_cose,
        trust.key_id.as_bytes(),
        OFFICIAL_STATUS_AAD,
        &public_key,
        validate_official_status_schema,
        "OFFICIAL_STATUS",
    ) {
        Ok(value) => value,
        Err((state, code, message)) => return failed(report, state, code, message),
    };
    report.status_sequence = Some(status.sequence);
    if status.profile != OFFICIAL_STATUS_PROFILE || status.issuer != trust.issuer {
        return failed(
            report,
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_STATUS_ISSUER_SUBSTITUTION",
            "Status snapshot profile or issuer does not match the explicit trust snapshot.",
        );
    }
    if status.sequence < options.minimum_status_sequence {
        return failed(
            report,
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_STATUS_ROLLBACK",
            "Status snapshot sequence is older than the caller's rollback floor.",
        );
    }
    if let Some(expected) = options.expected_previous_status_digest {
        if status.previous_digest.as_deref() != Some(expected) {
            return failed(
                report,
                OfficialIdentityAssurance::Invalid,
                "OFFICIAL_STATUS_FORK",
                "Status snapshot does not extend the caller's expected predecessor digest.",
            );
        }
    }
    if status.effective_at < 0
        || status.generated_at < status.effective_at
        || status.generated_at > options.verification_time.saturating_add(300)
        || options.max_status_age_seconds < 0
        || options
            .verification_time
            .saturating_sub(status.generated_at)
            > options.max_status_age_seconds
    {
        return failed(
            report,
            OfficialIdentityAssurance::Indeterminate,
            "OFFICIAL_STATUS_STALE",
            "Status snapshot is future-dated, internally inconsistent, or older than the explicit freshness policy.",
        );
    }
    if status.entries.len() > OFFICIAL_MAX_STATUS_ENTRIES
        || status
            .entries
            .windows(2)
            .any(|pair| pair[0].attestation_id.as_bytes() >= pair[1].attestation_id.as_bytes())
    {
        return failed(
            report,
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_STATUS_ENTRIES_INVALID",
            "Status entries exceed limits or are not strictly sorted and unique.",
        );
    }
    let Some(entry) = status
        .entries
        .iter()
        .find(|entry| entry.attestation_id == attestation.attestation_id)
    else {
        return failed(
            report,
            OfficialIdentityAssurance::Indeterminate,
            "OFFICIAL_STATUS_ENTRY_ABSENT",
            "Current status snapshot has no entry for this attestation.",
        );
    };
    if entry.effective_at > options.verification_time {
        return failed(
            report,
            OfficialIdentityAssurance::Indeterminate,
            "OFFICIAL_STATUS_NOT_YET_EFFECTIVE",
            "The status entry is not effective at the explicit verification time.",
        );
    }
    match entry.status.as_str() {
        "valid" => {
            report.state = OfficialIdentityAssurance::ValidTrusted;
            report.code = "OFFICIAL_IDENTITY_VALID_TRUSTED".to_owned();
            report.message = "Official identity attestation, explicit issuer trust, creator-key binding, purpose consent, and current status all verify offline.".to_owned();
            report
        }
        "revoked" => failed(
            report,
            OfficialIdentityAssurance::Revoked,
            "OFFICIAL_ATTESTATION_REVOKED",
            "Official attestation is revoked in the verified status snapshot.",
        ),
        "expired" => failed(
            report,
            OfficialIdentityAssurance::Expired,
            "OFFICIAL_ATTESTATION_EXPIRED",
            "Official attestation is expired in the verified status snapshot.",
        ),
        _ => failed(
            report,
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_STATUS_VALUE_UNSUPPORTED",
            "Status snapshot contains an unsupported status value.",
        ),
    }
}

fn parse_profile<T: DeserializeOwned>(
    bytes: &[u8],
    schema: fn(&serde_json::Value) -> Result<(), Vec<String>>,
    prefix: &'static str,
) -> Result<T, (OfficialIdentityAssurance, &'static str, String)> {
    if bytes.is_empty() || bytes.len() > OFFICIAL_MAX_JSON_BYTES {
        return Err((
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_INPUT_LIMIT_EXCEEDED",
            format!("{prefix} JSON is empty or exceeds 64 KiB."),
        ));
    }
    let value = parse_json_strict::<serde_json::Value>(bytes).map_err(|error| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_JSON_MALFORMED",
            format!("{prefix} strict JSON failed: {error}"),
        )
    })?;
    schema(&value).map_err(|errors| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_SCHEMA_INVALID",
            format!("{prefix} schema failed: {}", errors.join("; ")),
        )
    })?;
    serde_json::from_value(value).map_err(|error| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_MODEL_INVALID",
            format!("{prefix} model failed: {error}"),
        )
    })
}

fn verify_cose_payload<T: DeserializeOwned + serde::Serialize>(
    bytes: &[u8],
    expected_key_id: &[u8],
    external_aad: &[u8],
    public_key: &VerifyingKey,
    schema: fn(&serde_json::Value) -> Result<(), Vec<String>>,
    prefix: &'static str,
) -> Result<T, (OfficialIdentityAssurance, &'static str, String)> {
    if bytes.is_empty() || bytes.len() > OFFICIAL_MAX_COSE_BYTES {
        return Err((
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_INPUT_LIMIT_EXCEEDED",
            format!("{prefix} COSE is empty or exceeds 64 KiB."),
        ));
    }
    let sign1 = CoseSign1::from_tagged_slice(bytes).map_err(|error| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_COSE_MALFORMED",
            format!("{prefix} tagged COSE_Sign1 failed: {error}"),
        )
    })?;
    let canonical = sign1.clone().to_tagged_vec().map_err(|error| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_COSE_MALFORMED",
            format!("{prefix} COSE serialization failed: {error}"),
        )
    })?;
    if canonical != bytes || !sign1.unprotected.is_empty() {
        return Err((
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_COSE_NON_DETERMINISTIC",
            format!(
                "{prefix} COSE must use the canonical tagged encoding and an empty unprotected header."
            ),
        ));
    }
    let protected = &sign1.protected.header;
    if protected.alg != Some(RegisteredLabelWithPrivate::Assigned(iana::Algorithm::EdDSA)) {
        return Err((
            OfficialIdentityAssurance::Unsupported,
            "OFFICIAL_COSE_ALGORITHM_UNSUPPORTED",
            format!("{prefix} protected algorithm must be EdDSA (-8)."),
        ));
    }
    if protected.key_id != expected_key_id {
        return Err((
            OfficialIdentityAssurance::Invalid,
            "OFFICIAL_COSE_KID_MISMATCH",
            format!("{prefix} KID does not match the explicit issuer trust snapshot."),
        ));
    }
    let mut remainder = protected.clone();
    remainder.alg = None;
    remainder.key_id.clear();
    if !remainder.is_empty() {
        return Err((
            OfficialIdentityAssurance::Unsupported,
            "OFFICIAL_COSE_CRITICAL_HEADER_UNSUPPORTED",
            format!("{prefix} protected header contains unsupported fields."),
        ));
    }
    let canonical_protected = protected.clone().to_vec().map_err(|error| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_COSE_MALFORMED",
            format!("{prefix} protected header failed: {error}"),
        )
    })?;
    if sign1.protected.original_data.as_deref() != Some(canonical_protected.as_slice()) {
        return Err((
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_COSE_NON_DETERMINISTIC",
            format!("{prefix} protected header is not canonical."),
        ));
    }
    let payload = sign1.payload.as_deref().ok_or_else(|| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_COSE_PAYLOAD_ABSENT",
            format!("{prefix} must contain its JCS payload."),
        )
    })?;
    let value: T = parse_profile(payload, schema, prefix)?;
    let expected_payload = canonical_json(&value).map_err(|error| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_JCS_FAILED",
            error.to_string(),
        )
    })?;
    if expected_payload != payload {
        return Err((
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_PAYLOAD_NON_JCS",
            format!("{prefix} payload is not the exact RFC 8785 JCS encoding."),
        ));
    }
    let signature = Signature::from_slice(&sign1.signature).map_err(|error| {
        (
            OfficialIdentityAssurance::Malformed,
            "OFFICIAL_SIGNATURE_MALFORMED",
            error.to_string(),
        )
    })?;
    public_key.verify_strict(&sign1.tbs_data(external_aad), &signature).map_err(|_| {
        (OfficialIdentityAssurance::Invalid, "OFFICIAL_SIGNATURE_INVALID", format!("{prefix} signature does not validate for the imported issuer key and profile AAD."))
    })?;
    Ok(value)
}

fn decode_public_key(value: &str) -> Result<VerifyingKey, String> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| "Issuer public key is not strict base64.".to_owned())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Issuer Ed25519 public key must contain exactly 32 bytes.".to_owned())?;
    VerifyingKey::from_bytes(&bytes).map_err(|error| error.to_string())
}

fn normalize_fingerprint(value: &str) -> String {
    if value.starts_with("sha256:") {
        value.to_owned()
    } else {
        format!("sha256:{value}")
    }
}

fn prefixed_digest(bytes: &[u8]) -> String {
    format!("sha256:{}", sha256_bytes(bytes))
}

fn empty_report(
    attestation_sha256: String,
    issuer_trust_sha256: String,
) -> OfficialIdentityVerification {
    OfficialIdentityVerification {
        state: OfficialIdentityAssurance::Malformed,
        code: "OFFICIAL_VERIFICATION_INCOMPLETE".to_owned(),
        message: "Official identity verification did not complete.".to_owned(),
        issuer: None,
        attestation_id: None,
        display_claim: None,
        creator_key_fingerprint: None,
        purpose: None,
        method_class: None,
        trust_sequence: 0,
        issuer_trust_sha256,
        status_sequence: None,
        attestation_sha256,
        status_sha256: None,
    }
}

fn populate_attestation(report: &mut OfficialIdentityVerification, value: &OfficialAttestation) {
    report.issuer = Some(value.issuer.clone());
    report.attestation_id = Some(value.attestation_id);
    report.display_claim = Some(value.subject.display_claim.clone());
    report.creator_key_fingerprint = Some(value.creator_key_fingerprint.clone());
    report.purpose = Some(value.purpose.clone());
    report.method_class = Some(value.method_class);
}

fn failed(
    mut report: OfficialIdentityVerification,
    state: OfficialIdentityAssurance,
    code: impl Into<String>,
    message: impl Into<String>,
) -> OfficialIdentityVerification {
    report.state = state;
    report.code = code.into();
    report.message = message.into();
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_public_creator_fingerprint_without_changing_prefixed_values() {
        let digest = "a".repeat(64);
        assert_eq!(normalize_fingerprint(&digest), format!("sha256:{digest}"));
        assert_eq!(
            normalize_fingerprint(&format!("sha256:{digest}")),
            format!("sha256:{digest}")
        );
    }

    #[test]
    fn empty_inputs_fail_closed_without_panicking() {
        let report = verify_official_identity(OfficialIdentityVerifyOptions::strict(
            b"",
            b"",
            None,
            &"a".repeat(64),
            "creator_identity",
            1,
        ));
        assert_eq!(report.state, OfficialIdentityAssurance::Malformed);
        assert_eq!(report.code, "OFFICIAL_INPUT_LIMIT_EXCEEDED");
    }
}
