use std::time::SystemTime;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use cms::cert::CertificateChoices;
use cms::signed_data::{SignedData, SignerIdentifier};
use const_oid::ObjectIdentifier;
use der::asn1::{Int, OctetString, Uint};
use der::{Any, Decode, Encode, Sequence};
use proof_schema::{
    RevocationEvidenceState, TRUSTED_TIMESTAMP_PROFILE, TSA_TRUST_PROFILE, TimeAssurance,
    TrustedTimeEvidence, TrustedTimestampDescriptor, TsaProfileSummary, TsaTrustProfile,
    format_canonical_utc, parse_canonical_rfc3339, parse_json_strict, validate_tsa_profile_schema,
};
use rand_core::{OsRng, RngCore};
use rustls_pki_types::{CertificateDer, UnixTime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sigstore_tsa::{VerifyOpts, verify_timestamp_response};
use webpki::{
    ALL_VERIFICATION_ALGS, BorrowedCertRevocationList, EndEntityCert, KeyUsage,
    RevocationOptionsBuilder, anchor_from_trusted_cert,
};
use x509_cert::Certificate;
use x509_cert::ext::pkix::{ExtendedKeyUsage, SubjectKeyIdentifier};
use x509_cert::spki::AlgorithmIdentifierOwned;
use x509_tsp::{MessageImprint, TimeStampReq, TimeStampResp, TspVersion, TstInfo};

use crate::{CoreError, CoreResult, ErrorKind, canonical_json, sha256_bytes};

const OID_SHA256: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.1");
const OID_SIGNED_DATA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.7.2");
const OID_EC_PUBLIC_KEY: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.2.1");
const OID_P256: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.3.1.7");
const OID_P384: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.132.0.34");
const OID_EKU: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.37");
const OID_TIME_STAMPING: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.8");
const OID_SUBJECT_KEY_IDENTIFIER: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.14");
const OID_SIGNING_CERTIFICATE_V2: ObjectIdentifier =
    ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.16.2.47");
const TIMESTAMPING_EKU_DER_CONTENT: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x08];

#[derive(Debug, Clone)]
pub struct ParsedTsaProfile {
    pub profile: TsaTrustProfile,
    pub canonical_json: String,
    pub digest: String,
    roots: Vec<Vec<u8>>,
    intermediates: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TimestampRequestDisclosure {
    pub endpoint: String,
    pub content_type: String,
    pub message_imprint_sha256: String,
    pub nonce: String,
    pub requested_policy: String,
    pub tsa_profile_sha256: String,
    pub request_der_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimestampVerification {
    pub state: TimeAssurance,
    pub evidence: TrustedTimeEvidence,
    pub code: &'static str,
    pub message: String,
}

#[derive(Clone, Debug, Sequence)]
struct EssCertIdV2 {
    #[asn1(optional = "true")]
    hash_algorithm: Option<AlgorithmIdentifierOwned>,
    cert_hash: OctetString,
    #[asn1(optional = "true")]
    issuer_serial: Option<Any>,
}

#[derive(Clone, Debug, Sequence)]
struct SigningCertificateV2 {
    certs: Vec<EssCertIdV2>,
    #[asn1(optional = "true")]
    policies: Option<Any>,
}

pub fn parse_tsa_profile(json_text: &str) -> CoreResult<ParsedTsaProfile> {
    if json_text.len() > 1024 * 1024 {
        return Err(timestamp_error(
            "TSA_PROFILE_LIMIT_EXCEEDED",
            "TSA profile exceeds the 1 MiB limit.",
        ));
    }
    let value = parse_json_strict(json_text.as_bytes())
        .map_err(|error| timestamp_error("TSA_PROFILE_JSON_INVALID", error.to_string()))?;
    validate_tsa_profile_schema(&value)
        .map_err(|errors| timestamp_error("TSA_PROFILE_SCHEMA_INVALID", errors.join("; ")))?;
    let profile: TsaTrustProfile = serde_json::from_value(value)
        .map_err(|error| timestamp_error("TSA_PROFILE_MODEL_INVALID", error.to_string()))?;
    if let Some(issue) = profile.validate().into_iter().next() {
        return Err(timestamp_error(
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        ));
    }
    if profile.profile != TSA_TRUST_PROFILE {
        return Err(timestamp_error(
            "TSA_PROFILE_UNSUPPORTED",
            "TSA trust profile identifier is unsupported.",
        ));
    }
    let canonical = canonical_json(&profile)?;
    let canonical_json = String::from_utf8(canonical.clone()).map_err(|_| {
        timestamp_error(
            "TSA_PROFILE_CANONICALIZATION_FAILED",
            "Canonical TSA profile was not UTF-8.",
        )
    })?;
    let roots = decode_certificates(&profile.roots_der_base64, "TSA_ROOT_INVALID")?;
    if roots.is_empty() {
        return Err(timestamp_error(
            "TSA_ROOTS_EMPTY",
            "At least one explicit TSA trust root is required.",
        ));
    }
    let intermediates = decode_certificates(
        &profile.intermediates_der_base64,
        "TSA_INTERMEDIATE_INVALID",
    )?;
    for value in profile
        .https_roots_der_base64
        .iter()
        .chain(profile.revocation.crls_der_base64.iter())
        .chain(profile.revocation.ocsp_responses_der_base64.iter())
    {
        decode_base64_canonical(value, 1024 * 1024, "TSA_PROFILE_DER_INVALID")?;
    }
    Ok(ParsedTsaProfile {
        profile,
        canonical_json,
        digest: sha256_bytes(&canonical),
        roots,
        intermediates,
    })
}

pub fn tsa_profile_summary(profile: &ParsedTsaProfile) -> TsaProfileSummary {
    TsaProfileSummary {
        profile_sha256: profile.digest.clone(),
        source_label: profile.profile.source_label.clone(),
        endpoint: profile.profile.endpoint.clone(),
        endpoint_scope: profile.profile.endpoint_scope.clone(),
        allowed_policy_oids: profile.profile.allowed_policy_oids.clone(),
        root_count: profile.profile.roots_der_base64.len() as u64,
        intermediate_count: profile.profile.intermediates_der_base64.len() as u64,
        https_root_count: profile.profile.https_roots_der_base64.len() as u64,
        revocation_evidence_count: (profile.profile.revocation.crls_der_base64.len()
            + profile.profile.revocation.ocsp_responses_der_base64.len())
            as u64,
        effective_at: profile.profile.effective_at.clone(),
        expires_at: profile.profile.expires_at.clone(),
    }
}

pub fn random_timestamp_nonce() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    encode_hex(&bytes)
}

pub fn build_timestamp_request(
    signature_bytes: &[u8],
    descriptor: &TrustedTimestampDescriptor,
    profile: &ParsedTsaProfile,
) -> CoreResult<TimestampRequestDisclosure> {
    ensure_profile_matches(descriptor, profile)?;
    let nonce_bytes = decode_hex_16(&descriptor.nonce)?;
    let nonce_value = unsigned_integer(&nonce_bytes)?;
    let policy = if descriptor.requested_policy == "any" {
        None
    } else {
        Some(
            ObjectIdentifier::new(&descriptor.requested_policy).map_err(|error| {
                timestamp_error("TRUSTED_TIMESTAMP_POLICY_INVALID", error.to_string())
            })?,
        )
    };
    let imprint = Sha256::digest(signature_bytes);
    let request = TimeStampReq {
        version: TspVersion::V1,
        message_imprint: MessageImprint {
            hash_algorithm: AlgorithmIdentifierOwned {
                oid: OID_SHA256,
                parameters: Some(Any::null()),
            },
            hashed_message: OctetString::new(imprint.to_vec()).map_err(|error| {
                timestamp_error("TRUSTED_TIMESTAMP_REQUEST_INVALID", error.to_string())
            })?,
        },
        req_policy: policy,
        nonce: Some(nonce_value),
        cert_req: true,
        extensions: None,
    };
    let der = request.to_der().map_err(|error| {
        timestamp_error(
            "TRUSTED_TIMESTAMP_REQUEST_ENCODING_FAILED",
            error.to_string(),
        )
    })?;
    Ok(TimestampRequestDisclosure {
        endpoint: profile.profile.endpoint.clone(),
        content_type: "application/timestamp-query".to_owned(),
        message_imprint_sha256: encode_hex(&imprint),
        nonce: descriptor.nonce.clone(),
        requested_policy: descriptor.requested_policy.clone(),
        tsa_profile_sha256: profile.digest.clone(),
        request_der_base64: STANDARD.encode(der),
    })
}

pub fn verify_timestamp_strict(
    response_der: &[u8],
    signature_bytes: &[u8],
    descriptor: &TrustedTimestampDescriptor,
    profile: &ParsedTsaProfile,
    verified_at: &str,
) -> TimestampVerification {
    let mut evidence = TrustedTimeEvidence {
        profile: TRUSTED_TIMESTAMP_PROFILE.to_owned(),
        timestamp_path: descriptor.timestamp_path.clone(),
        tsa_profile_sha256: descriptor.tsa_profile_sha256.clone(),
        requested_policy: descriptor.requested_policy.clone(),
        granted_policy: None,
        gen_time: None,
        source_label: Some(profile.profile.source_label.clone()),
        revocation: RevocationEvidenceState::NotProvided,
    };
    if response_der.is_empty() || response_der.len() > 1024 * 1024 {
        return timestamp_failure(
            TimeAssurance::Malformed,
            evidence,
            "TRUSTED_TIMESTAMP_SIZE_INVALID",
            "Timestamp response must contain between 1 byte and 1 MiB of DER.",
        );
    }
    if let Err(error) = ensure_profile_matches(descriptor, profile) {
        return timestamp_failure(
            TimeAssurance::Untrusted,
            evidence,
            error.code,
            error.message,
        );
    }
    let parsed = match parse_timestamp_response(response_der) {
        Ok(parsed) => parsed,
        Err(failure) => {
            return timestamp_failure(failure.state, evidence, failure.code, failure.message);
        }
    };
    evidence.granted_policy = Some(parsed.policy.clone());
    evidence.gen_time = Some(parsed.gen_time.clone());
    if parsed.message_imprint != Sha256::digest(signature_bytes).as_slice() {
        return timestamp_failure(
            TimeAssurance::ImprintMismatch,
            evidence,
            "TRUSTED_TIMESTAMP_IMPRINT_MISMATCH",
            "Timestamp message imprint does not match the exact creator COSE_Sign1 bytes.",
        );
    }
    if parsed.nonce.as_deref() != Some(descriptor.nonce.as_str()) {
        return timestamp_failure(
            TimeAssurance::NonceMismatch,
            evidence,
            "TRUSTED_TIMESTAMP_NONCE_MISMATCH",
            "Timestamp response nonce does not match the predeclared 128-bit request nonce.",
        );
    }
    if descriptor.requested_policy != "any" && parsed.policy != descriptor.requested_policy {
        return timestamp_failure(
            TimeAssurance::PolicyMismatch,
            evidence,
            "TRUSTED_TIMESTAMP_POLICY_MISMATCH",
            "Timestamp response policy differs from the predeclared requested policy.",
        );
    }
    if !profile
        .profile
        .allowed_policy_oids
        .iter()
        .any(|allowed| allowed == &parsed.policy)
    {
        return timestamp_failure(
            TimeAssurance::PolicyMismatch,
            evidence,
            "TRUSTED_TIMESTAMP_POLICY_NOT_ALLOWED",
            "Timestamp response policy is not allowed by the imported trust snapshot.",
        );
    }
    if let Err(failure) = verify_signer_profile(&parsed.signed_data) {
        return timestamp_failure(failure.state, evidence, failure.code, failure.message);
    }
    let roots = profile
        .roots
        .iter()
        .cloned()
        .map(CertificateDer::from)
        .collect();
    let intermediates = profile
        .intermediates
        .iter()
        .cloned()
        .map(CertificateDer::from)
        .collect();
    let options = VerifyOpts::new()
        .with_roots(roots)
        .with_intermediates(intermediates);
    if let Err(error) = verify_timestamp_response(response_der, signature_bytes, options) {
        let (state, code) = match &error {
            sigstore_tsa::Error::CertificateValidationError(_) => (
                TimeAssurance::InvalidChain,
                "TRUSTED_TIMESTAMP_CHAIN_INVALID",
            ),
            sigstore_tsa::Error::InvalidEKU => {
                (TimeAssurance::InvalidEku, "TRUSTED_TIMESTAMP_EKU_INVALID")
            }
            sigstore_tsa::Error::SignatureVerificationError(message)
                if message.contains("unsupported") || message.contains("not an EC key") =>
            {
                (
                    TimeAssurance::UnsupportedAlgorithm,
                    "TRUSTED_TIMESTAMP_ALGORITHM_UNSUPPORTED",
                )
            }
            sigstore_tsa::Error::SignatureVerificationError(_) => (
                TimeAssurance::InvalidSignature,
                "TRUSTED_TIMESTAMP_SIGNATURE_INVALID",
            ),
            sigstore_tsa::Error::HashMismatch { .. } => (
                TimeAssurance::ImprintMismatch,
                "TRUSTED_TIMESTAMP_IMPRINT_MISMATCH",
            ),
            _ => (TimeAssurance::Malformed, "TRUSTED_TIMESTAMP_MALFORMED"),
        };
        return timestamp_failure(state, evidence, code, error.to_string());
    }
    let verified = match parse_canonical_rfc3339(verified_at) {
        Ok(value) => value,
        Err(message) => {
            return timestamp_failure(
                TimeAssurance::ExpiredOrStale,
                evidence,
                "TSA_PROFILE_VALIDITY_INDETERMINATE",
                message,
            );
        }
    };
    let generated = match parse_canonical_rfc3339(&parsed.gen_time) {
        Ok(value) => value,
        Err(message) => {
            return timestamp_failure(
                TimeAssurance::Malformed,
                evidence,
                "TRUSTED_TIMESTAMP_TIME_INVALID",
                message,
            );
        }
    };
    let effective = parse_canonical_rfc3339(&profile.profile.effective_at)
        .expect("validated TSA profile effective_at");
    let expires = parse_canonical_rfc3339(&profile.profile.expires_at)
        .expect("validated TSA profile expires_at");
    if generated < effective || generated > expires || verified > expires {
        return timestamp_failure(
            TimeAssurance::ExpiredOrStale,
            evidence,
            "TSA_PROFILE_EXPIRED_OR_STALE",
            "Timestamp generation or verification time is outside the imported trust snapshot validity window.",
        );
    }
    match verify_revocation(&parsed.signed_data, profile, generated.unix_timestamp()) {
        Ok(RevocationEvidenceState::NotProvided) => {}
        Ok(state) => evidence.revocation = state,
        Err((state, code, message)) => {
            evidence.revocation = state;
            return timestamp_failure(
                if evidence.revocation == RevocationEvidenceState::Revoked {
                    TimeAssurance::InvalidChain
                } else {
                    TimeAssurance::IndeterminateRevocation
                },
                evidence,
                code,
                message,
            );
        }
    }
    TimestampVerification {
        state: TimeAssurance::ValidTrusted,
        evidence,
        code: "TRUSTED_TIMESTAMP_VALID",
        message: "RFC 3161 timestamp, nonce, policy, ESS binding, EKU, signature, and explicit trust chain are valid.".to_owned(),
    }
}

fn verify_revocation(
    signed_data: &SignedData,
    profile: &ParsedTsaProfile,
    generated_unix: i64,
) -> Result<RevocationEvidenceState, (RevocationEvidenceState, &'static str, String)> {
    if !profile
        .profile
        .revocation
        .ocsp_responses_der_base64
        .is_empty()
    {
        return Err((
            RevocationEvidenceState::Indeterminate,
            "TSA_OCSP_EVIDENCE_UNSUPPORTED",
            "Imported OCSP evidence cannot be evaluated by the offline v0.4 verifier.".to_owned(),
        ));
    }
    if profile.profile.revocation.crls_der_base64.is_empty() {
        return if profile.profile.revocation.required {
            Err((
                RevocationEvidenceState::Indeterminate,
                "TSA_REVOCATION_EVIDENCE_REQUIRED",
                "The trust snapshot requires revocation evidence but contains no CRL or supported OCSP response.".to_owned(),
            ))
        } else {
            Ok(RevocationEvidenceState::NotProvided)
        };
    }

    let (signer_der, mut embedded_intermediates) =
        signer_and_intermediates(signed_data).map_err(|failure| {
            (
                RevocationEvidenceState::Indeterminate,
                failure.code,
                failure.message,
            )
        })?;
    embedded_intermediates.extend(profile.intermediates.iter().cloned());
    let signer_certificate = CertificateDer::from(signer_der.as_slice());
    let end_entity = EndEntityCert::try_from(&signer_certificate).map_err(|error| {
        (
            RevocationEvidenceState::Indeterminate,
            "TSA_REVOCATION_SIGNER_INVALID",
            error.to_string(),
        )
    })?;
    let root_ders = profile
        .roots
        .iter()
        .map(|value| CertificateDer::from(value.as_slice()))
        .collect::<Vec<_>>();
    let anchors = root_ders
        .iter()
        .map(anchor_from_trusted_cert)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            (
                RevocationEvidenceState::Indeterminate,
                "TSA_REVOCATION_ROOT_INVALID",
                error.to_string(),
            )
        })?;
    let intermediate_ders = embedded_intermediates
        .iter()
        .map(|value| CertificateDer::from(value.as_slice()))
        .collect::<Vec<_>>();
    let crl_bytes = profile
        .profile
        .revocation
        .crls_der_base64
        .iter()
        .map(|value| {
            STANDARD
                .decode(value)
                .expect("validated canonical CRL base64")
        })
        .collect::<Vec<_>>();
    let crls = crl_bytes
        .iter()
        .map(|value| BorrowedCertRevocationList::from_der(value).map(Into::into))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            (
                RevocationEvidenceState::Indeterminate,
                "TSA_CRL_MALFORMED",
                error.to_string(),
            )
        })?;
    let crl_refs = crls.iter().collect::<Vec<_>>();
    let revocation = RevocationOptionsBuilder::new(&crl_refs)
        .expect("non-empty CRL collection")
        .build();
    let generated = u64::try_from(generated_unix).map_err(|_| {
        (
            RevocationEvidenceState::Indeterminate,
            "TSA_REVOCATION_TIME_INVALID",
            "Timestamp generation time predates the Unix epoch.".to_owned(),
        )
    })?;
    match end_entity.verify_for_usage(
        ALL_VERIFICATION_ALGS,
        &anchors,
        &intermediate_ders,
        UnixTime::since_unix_epoch(std::time::Duration::from_secs(generated)),
        KeyUsage::required(TIMESTAMPING_EKU_DER_CONTENT),
        Some(revocation),
        None,
    ) {
        Ok(_) => Ok(RevocationEvidenceState::ValidCrl),
        Err(webpki::Error::CertRevoked) => Err((
            RevocationEvidenceState::Revoked,
            "TSA_CERTIFICATE_REVOKED",
            "The TSA signer certificate is revoked by the imported CRL snapshot.".to_owned(),
        )),
        Err(error) => Err((
            RevocationEvidenceState::Indeterminate,
            "TSA_REVOCATION_INDETERMINATE",
            error.to_string(),
        )),
    }
}

fn signer_and_intermediates(
    signed_data: &SignedData,
) -> Result<(Vec<u8>, Vec<Vec<u8>>), TimestampParseFailure> {
    let signer = signed_data.signer_infos.0.get(0).ok_or_else(|| {
        parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_SIGNER_MISSING",
            "Timestamp token has no signer.",
        )
    })?;
    let certificates = signed_data.certificates.as_ref().ok_or_else(|| {
        parse_failure(
            TimeAssurance::InvalidChain,
            "TRUSTED_TIMESTAMP_CERTIFICATES_MISSING",
            "Timestamp token contains no certificates.",
        )
    })?;
    let mut signer_der = None;
    let mut intermediates = Vec::new();
    for choice in certificates.0.iter() {
        let CertificateChoices::Certificate(certificate) = choice else {
            continue;
        };
        let der = certificate.to_der().map_err(|error| {
            parse_failure(
                TimeAssurance::InvalidChain,
                "TRUSTED_TIMESTAMP_CERTIFICATE_MALFORMED",
                error.to_string(),
            )
        })?;
        if signer_matches(&signer.sid, certificate) {
            signer_der = Some(der);
        } else {
            intermediates.push(der);
        }
    }
    Ok((
        signer_der.ok_or_else(|| {
            parse_failure(
                TimeAssurance::InvalidChain,
                "TRUSTED_TIMESTAMP_SIGNER_CERTIFICATE_MISSING",
                "Timestamp signer certificate is missing.",
            )
        })?,
        intermediates,
    ))
}

struct ParsedTimestamp {
    signed_data: SignedData,
    message_imprint: Vec<u8>,
    nonce: Option<String>,
    policy: String,
    gen_time: String,
}

struct TimestampParseFailure {
    state: TimeAssurance,
    code: &'static str,
    message: String,
}

fn parse_timestamp_response(response_der: &[u8]) -> Result<ParsedTimestamp, TimestampParseFailure> {
    let response = TimeStampResp::from_der(response_der).map_err(|error| {
        parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_MALFORMED",
            error.to_string(),
        )
    })?;
    let token = response.time_stamp_token.ok_or_else(|| {
        parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_TOKEN_MISSING",
            "Timestamp response has no ContentInfo token.",
        )
    })?;
    if token.content_type != OID_SIGNED_DATA {
        return Err(parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_CONTENT_TYPE_INVALID",
            "Timestamp token is not CMS SignedData.",
        ));
    }
    let signed_data = token.content.decode_as::<SignedData>().map_err(|error| {
        parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_CMS_MALFORMED",
            error.to_string(),
        )
    })?;
    if signed_data.signer_infos.0.len() != 1 {
        return Err(parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_SIGNER_COUNT_INVALID",
            "Timestamp token must contain exactly one CMS SignerInfo.",
        ));
    }
    let content = signed_data
        .encap_content_info
        .econtent
        .as_ref()
        .ok_or_else(|| {
            parse_failure(
                TimeAssurance::Malformed,
                "TRUSTED_TIMESTAMP_INFO_MISSING",
                "Timestamp token has no encapsulated TSTInfo.",
            )
        })?;
    let info = TstInfo::from_der(content.value()).map_err(|error| {
        parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_INFO_MALFORMED",
            error.to_string(),
        )
    })?;
    if info.message_imprint.hash_algorithm.oid != OID_SHA256
        || info.message_imprint.hashed_message.as_bytes().len() != 32
    {
        return Err(parse_failure(
            TimeAssurance::UnsupportedAlgorithm,
            "TRUSTED_TIMESTAMP_IMPRINT_ALGORITHM_UNSUPPORTED",
            "Only SHA-256 RFC 3161 message imprints are accepted.",
        ));
    }
    let nonce = info
        .nonce
        .as_ref()
        .map(|value| {
            let bytes = trim_unsigned_integer(value.as_bytes());
            format_fixed_hex(bytes, 16)
        })
        .transpose()
        .map_err(|message| {
            parse_failure(
                TimeAssurance::NonceMismatch,
                "TRUSTED_TIMESTAMP_NONCE_INVALID",
                message,
            )
        })?;
    let gen_time =
        format_canonical_utc(SystemTime::from(info.gen_time).into()).map_err(|message| {
            parse_failure(
                TimeAssurance::Malformed,
                "TRUSTED_TIMESTAMP_TIME_INVALID",
                message,
            )
        })?;
    Ok(ParsedTimestamp {
        signed_data,
        message_imprint: info.message_imprint.hashed_message.as_bytes().to_vec(),
        nonce,
        policy: info.policy.to_string(),
        gen_time,
    })
}

fn verify_signer_profile(signed_data: &SignedData) -> Result<(), TimestampParseFailure> {
    let signer = signed_data.signer_infos.0.get(0).ok_or_else(|| {
        parse_failure(
            TimeAssurance::Malformed,
            "TRUSTED_TIMESTAMP_SIGNER_MISSING",
            "Timestamp token has no signer.",
        )
    })?;
    let certificates = signed_data.certificates.as_ref().ok_or_else(|| {
        parse_failure(
            TimeAssurance::InvalidChain,
            "TRUSTED_TIMESTAMP_CERTIFICATES_MISSING",
            "Timestamp token does not contain the requested signer certificate.",
        )
    })?;
    let signer_certificate = certificates
        .0
        .iter()
        .find_map(|choice| match choice {
            CertificateChoices::Certificate(certificate)
                if signer_matches(&signer.sid, certificate) =>
            {
                Some(certificate)
            }
            _ => None,
        })
        .ok_or_else(|| {
            parse_failure(
                TimeAssurance::InvalidChain,
                "TRUSTED_TIMESTAMP_SIGNER_CERTIFICATE_MISSING",
                "Timestamp signer certificate does not match the CMS SignerIdentifier.",
            )
        })?;
    verify_ecdsa_profile(signer_certificate)?;
    verify_critical_timestamp_eku(signer_certificate)?;
    verify_ess_binding(signer, signer_certificate)?;
    Ok(())
}

fn signer_matches(identifier: &SignerIdentifier, certificate: &Certificate) -> bool {
    match identifier {
        SignerIdentifier::IssuerAndSerialNumber(value) => {
            certificate.tbs_certificate.issuer == value.issuer
                && certificate.tbs_certificate.serial_number == value.serial_number
        }
        SignerIdentifier::SubjectKeyIdentifier(expected) => certificate
            .tbs_certificate
            .extensions
            .as_ref()
            .and_then(|extensions| {
                extensions
                    .iter()
                    .find(|extension| extension.extn_id == OID_SUBJECT_KEY_IDENTIFIER)
            })
            .and_then(|extension| {
                SubjectKeyIdentifier::from_der(extension.extn_value.as_bytes()).ok()
            })
            .is_some_and(|actual| &actual == expected),
    }
}

fn verify_ecdsa_profile(certificate: &Certificate) -> Result<(), TimestampParseFailure> {
    let spki = &certificate.tbs_certificate.subject_public_key_info;
    if spki.algorithm.oid != OID_EC_PUBLIC_KEY {
        return Err(parse_failure(
            TimeAssurance::UnsupportedAlgorithm,
            "TRUSTED_TIMESTAMP_ALGORITHM_UNSUPPORTED",
            "Initial trusted-time profile accepts only ECDSA TSA signer keys.",
        ));
    }
    let curve = spki
        .algorithm
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.decode_as::<ObjectIdentifier>().ok());
    if !matches!(curve, Some(OID_P256 | OID_P384)) {
        return Err(parse_failure(
            TimeAssurance::UnsupportedAlgorithm,
            "TRUSTED_TIMESTAMP_CURVE_UNSUPPORTED",
            "Initial trusted-time profile accepts only ECDSA P-256 or P-384 signer keys.",
        ));
    }
    Ok(())
}

fn verify_critical_timestamp_eku(certificate: &Certificate) -> Result<(), TimestampParseFailure> {
    let extension = certificate
        .tbs_certificate
        .extensions
        .as_ref()
        .and_then(|extensions| extensions.iter().find(|value| value.extn_id == OID_EKU))
        .ok_or_else(|| {
            parse_failure(
                TimeAssurance::InvalidEku,
                "TRUSTED_TIMESTAMP_EKU_MISSING",
                "TSA signer certificate has no Extended Key Usage extension.",
            )
        })?;
    let eku = ExtendedKeyUsage::from_der(extension.extn_value.as_bytes()).map_err(|error| {
        parse_failure(
            TimeAssurance::InvalidEku,
            "TRUSTED_TIMESTAMP_EKU_INVALID",
            error.to_string(),
        )
    })?;
    if !extension.critical || eku.0.as_slice() != [OID_TIME_STAMPING] {
        return Err(parse_failure(
            TimeAssurance::InvalidEku,
            "TRUSTED_TIMESTAMP_EKU_INVALID",
            "TSA signer EKU must be critical and contain only id-kp-timeStamping.",
        ));
    }
    Ok(())
}

fn verify_ess_binding(
    signer: &cms::signed_data::SignerInfo,
    certificate: &Certificate,
) -> Result<(), TimestampParseFailure> {
    let attributes = signer.signed_attrs.as_ref().ok_or_else(|| {
        parse_failure(
            TimeAssurance::InvalidEss,
            "TRUSTED_TIMESTAMP_ESS_MISSING",
            "Timestamp signer has no signed attributes for ESS binding.",
        )
    })?;
    let attribute = attributes
        .iter()
        .filter(|attribute| attribute.oid == OID_SIGNING_CERTIFICATE_V2)
        .collect::<Vec<_>>();
    if attribute.len() != 1 || attribute[0].values.len() != 1 {
        return Err(parse_failure(
            TimeAssurance::InvalidEss,
            "TRUSTED_TIMESTAMP_ESS_INVALID",
            "Timestamp signer must contain exactly one SigningCertificateV2 attribute value.",
        ));
    }
    let encoded = attribute[0]
        .values
        .get(0)
        .ok_or_else(|| {
            parse_failure(
                TimeAssurance::InvalidEss,
                "TRUSTED_TIMESTAMP_ESS_INVALID",
                "SigningCertificateV2 attribute value is missing.",
            )
        })?
        .to_der()
        .map_err(|error| {
            parse_failure(
                TimeAssurance::InvalidEss,
                "TRUSTED_TIMESTAMP_ESS_INVALID",
                error.to_string(),
            )
        })?;
    let signing = SigningCertificateV2::from_der(&encoded).map_err(|error| {
        parse_failure(
            TimeAssurance::InvalidEss,
            "TRUSTED_TIMESTAMP_ESS_INVALID",
            error.to_string(),
        )
    })?;
    if signing.certs.len() != 1 {
        return Err(parse_failure(
            TimeAssurance::InvalidEss,
            "TRUSTED_TIMESTAMP_ESS_INVALID",
            "SigningCertificateV2 must bind exactly one TSA signer certificate.",
        ));
    }
    let cert_id = &signing.certs[0];
    if cert_id
        .hash_algorithm
        .as_ref()
        .is_some_and(|algorithm| algorithm.oid != OID_SHA256)
    {
        return Err(parse_failure(
            TimeAssurance::UnsupportedAlgorithm,
            "TRUSTED_TIMESTAMP_ESS_ALGORITHM_UNSUPPORTED",
            "SigningCertificateV2 must use SHA-256 certificate binding.",
        ));
    }
    let certificate_der = certificate.to_der().map_err(|error| {
        parse_failure(
            TimeAssurance::InvalidEss,
            "TRUSTED_TIMESTAMP_ESS_INVALID",
            error.to_string(),
        )
    })?;
    if cert_id.cert_hash.as_bytes() != Sha256::digest(certificate_der).as_slice() {
        return Err(parse_failure(
            TimeAssurance::InvalidEss,
            "TRUSTED_TIMESTAMP_ESS_MISMATCH",
            "SigningCertificateV2 does not bind the CMS signer certificate.",
        ));
    }
    Ok(())
}

fn ensure_profile_matches(
    descriptor: &TrustedTimestampDescriptor,
    profile: &ParsedTsaProfile,
) -> CoreResult<()> {
    if descriptor.profile != TRUSTED_TIMESTAMP_PROFILE {
        return Err(timestamp_error(
            "TRUSTED_TIMESTAMP_PROFILE_UNSUPPORTED",
            "Trusted timestamp profile is unsupported.",
        ));
    }
    if descriptor.tsa_profile_sha256 != profile.digest {
        return Err(timestamp_error(
            "TSA_PROFILE_DIGEST_MISMATCH",
            "Imported TSA profile does not match the digest predeclared in the signed Manifest.",
        ));
    }
    if descriptor.requested_policy != "any"
        && !profile
            .profile
            .allowed_policy_oids
            .iter()
            .any(|policy| policy == &descriptor.requested_policy)
    {
        return Err(timestamp_error(
            "TSA_PROFILE_POLICY_NOT_ALLOWED",
            "Requested timestamp policy is not allowed by the imported TSA profile.",
        ));
    }
    Ok(())
}

fn decode_certificates(values: &[String], code: &'static str) -> CoreResult<Vec<Vec<u8>>> {
    values
        .iter()
        .map(|value| {
            let bytes = decode_base64_canonical(value, 256 * 1024, code)?;
            Certificate::from_der(&bytes)
                .map_err(|error| timestamp_error(code, error.to_string()))?;
            Ok(bytes)
        })
        .collect()
}

fn decode_base64_canonical(
    value: &str,
    max_bytes: usize,
    code: &'static str,
) -> CoreResult<Vec<u8>> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|error| timestamp_error(code, error.to_string()))?;
    if bytes.is_empty() || bytes.len() > max_bytes || STANDARD.encode(&bytes) != value {
        return Err(timestamp_error(
            code,
            "Profile data must be non-empty bounded canonical base64.",
        ));
    }
    Ok(bytes)
}

fn unsigned_integer(bytes: &[u8]) -> CoreResult<Int> {
    let trimmed = trim_unsigned_integer(bytes);
    let canonical = if trimmed.is_empty() {
        &[0_u8][..]
    } else {
        trimmed
    };
    Uint::new(canonical)
        .map(Int::from)
        .map_err(|error| timestamp_error("TRUSTED_TIMESTAMP_NONCE_INVALID", error.to_string()))
}

fn trim_unsigned_integer(mut bytes: &[u8]) -> &[u8] {
    while bytes.first() == Some(&0) {
        bytes = &bytes[1..];
    }
    bytes
}

fn decode_hex_16(value: &str) -> CoreResult<[u8; 16]> {
    if value.len() != 32 {
        return Err(timestamp_error(
            "TRUSTED_TIMESTAMP_NONCE_INVALID",
            "Timestamp nonce must contain exactly 32 lowercase hexadecimal digits.",
        ));
    }
    let mut output = [0_u8; 16];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (hex_nibble(chunk[0])? << 4) | hex_nibble(chunk[1])?;
    }
    Ok(output)
}

fn hex_nibble(value: u8) -> CoreResult<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(timestamp_error(
            "TRUSTED_TIMESTAMP_NONCE_INVALID",
            "Timestamp nonce must use lowercase hexadecimal.",
        )),
    }
}

fn format_fixed_hex(bytes: &[u8], size: usize) -> Result<String, String> {
    if bytes.len() > size {
        return Err("Timestamp nonce exceeds the predeclared 128-bit size.".to_owned());
    }
    let mut padded = vec![0_u8; size - bytes.len()];
    padded.extend_from_slice(bytes);
    Ok(encode_hex(&padded))
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn timestamp_failure(
    state: TimeAssurance,
    evidence: TrustedTimeEvidence,
    code: &'static str,
    message: impl Into<String>,
) -> TimestampVerification {
    TimestampVerification {
        state,
        evidence,
        code,
        message: message.into(),
    }
}

fn parse_failure(
    state: TimeAssurance,
    code: &'static str,
    message: impl Into<String>,
) -> TimestampParseFailure {
    TimestampParseFailure {
        state,
        code,
        message: message.into(),
    }
}

fn timestamp_error(code: &'static str, message: impl Into<String>) -> CoreError {
    CoreError::new(ErrorKind::TrustedTime, code, message)
}
