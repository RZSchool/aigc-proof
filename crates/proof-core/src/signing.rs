use std::fmt;

use coset::cbor::value::Value as CborValue;
use coset::{
    Algorithm, CborSerializable, CoseKey, CoseKeyBuilder, CoseSign1, CoseSign1Builder,
    HeaderBuilder, KeyType, Label, RegisteredLabelWithPrivate, TaggedCborSerializable, iana,
};
use ed25519_dalek::{Signature, Signer as _, SigningKey, VerifyingKey};
use proof_schema::{
    CREATOR_SIGNATURE_PROFILE, CreatorSignatureDescriptor, CreatorSignatureEvidence, LocalTrust,
    SignatureAssurance, display_label_needs_confusable_warning, validate_display_label,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::{CoreError, CoreResult, ErrorKind};

pub const CREATOR_SIGNATURE_AAD: &[u8] = b"AIGC-PROOF\0CREATOR-SIGNATURE\0v0.3";
pub const DEFAULT_SIGNER_SERVICE: &str = "org.aigcproof.workbench.creator-key.v1";
pub const DEFAULT_SIGNER_USER: &str = "current-user";

const RECORD_MAGIC: &[u8] = b"AIGC-PROOF-SIGNER\0";
const RECORD_VERSION: u8 = 1;
const RECORD_ACTIVE: u8 = 1;
const RECORD_DISABLED: u8 = 2;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalSignerState {
    Missing,
    Active,
    Disabled,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LocalSignerStatus {
    pub state: LocalSignerState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_fingerprint: Option<String>,
    pub warning_codes: Vec<String>,
}

impl LocalSignerStatus {
    fn empty(state: LocalSignerState) -> Self {
        Self {
            state,
            display_label: None,
            key_fingerprint: None,
            warning_codes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyStoreError {
    pub code: &'static str,
    pub message: String,
    pub missing: bool,
}

impl fmt::Display for KeyStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for KeyStoreError {}

pub trait SignerKeyStore {
    fn load(&self) -> Result<Option<Zeroizing<Vec<u8>>>, KeyStoreError>;
    fn store(&self, value: &[u8]) -> Result<(), KeyStoreError>;
    fn delete(&self) -> Result<(), KeyStoreError>;
}

#[derive(Debug, Clone)]
pub struct OsSignerKeyStore {
    service: String,
    user: String,
}

impl Default for OsSignerKeyStore {
    fn default() -> Self {
        Self::new(DEFAULT_SIGNER_SERVICE, DEFAULT_SIGNER_USER)
    }
}

impl OsSignerKeyStore {
    pub fn new(service: impl Into<String>, user: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            user: user.into(),
        }
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    fn entry(&self) -> Result<keyring::Entry, KeyStoreError> {
        keyring::Entry::new(&self.service, &self.user).map_err(keyring_error)
    }
}

impl SignerKeyStore for OsSignerKeyStore {
    fn load(&self) -> Result<Option<Zeroizing<Vec<u8>>>, KeyStoreError> {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            match self.entry()?.get_secret() {
                Ok(secret) => Ok(Some(Zeroizing::new(secret))),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(keyring_error(error)),
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            Err(KeyStoreError {
                code: "SIGNER_STORE_UNAVAILABLE",
                message: "No production credential-store adapter is enabled for this platform."
                    .to_owned(),
                missing: false,
            })
        }
    }

    fn store(&self, value: &[u8]) -> Result<(), KeyStoreError> {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            self.entry()?.set_secret(value).map_err(keyring_error)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            let _ = value;
            Err(KeyStoreError {
                code: "SIGNER_STORE_UNAVAILABLE",
                message: "No production credential-store adapter is enabled for this platform."
                    .to_owned(),
                missing: false,
            })
        }
    }

    fn delete(&self) -> Result<(), KeyStoreError> {
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            match self.entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(keyring_error(error)),
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            Err(KeyStoreError {
                code: "SIGNER_STORE_UNAVAILABLE",
                message: "No production credential-store adapter is enabled for this platform."
                    .to_owned(),
                missing: false,
            })
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn keyring_error(error: keyring::Error) -> KeyStoreError {
    let missing = matches!(error, keyring::Error::NoEntry);
    KeyStoreError {
        code: if missing {
            "SIGNER_KEY_MISSING"
        } else {
            "SIGNER_STORE_UNAVAILABLE"
        },
        message: if missing {
            "No local creator key is present.".to_owned()
        } else {
            format!("Operating-system credential store is unavailable: {error}")
        },
        missing,
    }
}

struct SignerRecord {
    disabled: bool,
    display_label: String,
    public_key: [u8; 32],
    secret_key: Option<Zeroizing<[u8; 32]>>,
}

pub(crate) struct SigningMaterial {
    pub display_label: String,
    pub key_fingerprint: String,
    pub public_key_cose: Vec<u8>,
    secret_key: Zeroizing<[u8; 32]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignatureArtifacts {
    pub public_key_cose: Vec<u8>,
    pub signature_cose: Vec<u8>,
}

pub struct SignerService<S> {
    store: S,
}

impl<S: SignerKeyStore> SignerService<S> {
    pub fn new(store: S) -> Self {
        Self { store }
    }

    pub fn status(&self) -> LocalSignerStatus {
        match self.load_record() {
            Ok(None) => LocalSignerStatus::empty(LocalSignerState::Missing),
            Ok(Some(record)) => status_for_record(&record),
            Err(_) => LocalSignerStatus::empty(LocalSignerState::Unavailable),
        }
    }

    pub fn create(&self, display_label: &str) -> CoreResult<LocalSignerStatus> {
        validate_label(display_label)?;
        if self.load_record()?.is_some() {
            return Err(CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_KEY_ALREADY_EXISTS",
                "A local creator key already exists; use rotate for an explicit replacement.",
            ));
        }
        self.generate_and_store(display_label)
    }

    pub fn rotate(&self, display_label: &str) -> CoreResult<LocalSignerStatus> {
        validate_label(display_label)?;
        if self.load_record()?.is_none() {
            return Err(CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_KEY_MISSING",
                "No local creator key exists to rotate.",
            ));
        }
        self.generate_and_store(display_label)
    }

    pub fn disable(&self) -> CoreResult<LocalSignerStatus> {
        let record = self.load_record()?.ok_or_else(|| {
            CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_KEY_MISSING",
                "No local creator key exists to disable.",
            )
        })?;
        if record.disabled {
            return Ok(status_for_record(&record));
        }
        let disabled = SignerRecord {
            disabled: true,
            display_label: record.display_label,
            public_key: record.public_key,
            secret_key: None,
        };
        self.store_record(&disabled)?;
        Ok(status_for_record(&disabled))
    }

    pub fn export_public_key(&self) -> CoreResult<Vec<u8>> {
        let record = self.load_record()?.ok_or_else(|| {
            CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_KEY_MISSING",
                "No local creator key is present.",
            )
        })?;
        deterministic_public_key(&record.public_key)
    }

    pub fn cleanup(&self) -> CoreResult<()> {
        self.store.delete().map_err(store_error)
    }

    pub(crate) fn signing_material(&self) -> CoreResult<SigningMaterial> {
        let record = self.load_record()?.ok_or_else(|| {
            CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_KEY_MISSING",
                "Create a local creator key before sealing a signed package.",
            )
        })?;
        if record.disabled {
            return Err(CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_KEY_DISABLED",
                "The local creator key is disabled and cannot sign new packages.",
            ));
        }
        let secret_key = record.secret_key.ok_or_else(|| {
            CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_RECORD_INVALID",
                "The local creator key record is incomplete.",
            )
        })?;
        let public_key_cose = deterministic_public_key(&record.public_key)?;
        let key_fingerprint = sha256_hex(&public_key_cose);
        Ok(SigningMaterial {
            display_label: record.display_label,
            key_fingerprint,
            public_key_cose,
            secret_key,
        })
    }

    pub(crate) fn trust_for(&self, fingerprint: &str) -> LocalTrust {
        match self.load_record() {
            Ok(Some(record)) => match deterministic_public_key(&record.public_key) {
                Ok(bytes) if sha256_hex(&bytes) == fingerprint => {
                    if record.disabled {
                        LocalTrust::Disabled
                    } else {
                        LocalTrust::Trusted
                    }
                }
                _ => LocalTrust::Untrusted,
            },
            _ => LocalTrust::Untrusted,
        }
    }

    fn generate_and_store(&self, display_label: &str) -> CoreResult<LocalSignerStatus> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let record = SignerRecord {
            disabled: false,
            display_label: display_label.to_owned(),
            public_key: signing_key.verifying_key().to_bytes(),
            secret_key: Some(Zeroizing::new(signing_key.to_bytes())),
        };
        self.store_record(&record)?;
        Ok(status_for_record(&record))
    }

    fn load_record(&self) -> CoreResult<Option<SignerRecord>> {
        self.store
            .load()
            .map_err(store_error)?
            .map(|blob| decode_record(&blob))
            .transpose()
    }

    fn store_record(&self, record: &SignerRecord) -> CoreResult<()> {
        let blob = encode_record(record)?;
        self.store.store(&blob).map_err(store_error)
    }
}

impl SignerService<OsSignerKeyStore> {
    pub fn production() -> Self {
        Self::new(OsSignerKeyStore::default())
    }
}

fn store_error(error: KeyStoreError) -> CoreError {
    CoreError::new(ErrorKind::CredentialStore, error.code, error.message)
}

fn validate_label(label: &str) -> CoreResult<()> {
    validate_display_label(label).map_err(|message| {
        CoreError::new(ErrorKind::Signing, "CREATOR_DISPLAY_LABEL_INVALID", message)
    })
}

fn status_for_record(record: &SignerRecord) -> LocalSignerStatus {
    let fingerprint = deterministic_public_key(&record.public_key)
        .ok()
        .map(|bytes| sha256_hex(&bytes));
    LocalSignerStatus {
        state: if record.disabled {
            LocalSignerState::Disabled
        } else {
            LocalSignerState::Active
        },
        display_label: Some(record.display_label.clone()),
        key_fingerprint: fingerprint,
        warning_codes: if display_label_needs_confusable_warning(&record.display_label) {
            vec!["CREATOR_DISPLAY_LABEL_CONFUSABLE_REVIEW".to_owned()]
        } else {
            Vec::new()
        },
    }
}

fn encode_record(record: &SignerRecord) -> CoreResult<Zeroizing<Vec<u8>>> {
    let label = record.display_label.as_bytes();
    let label_len = u16::try_from(label.len()).map_err(|_| {
        CoreError::new(
            ErrorKind::CredentialStore,
            "SIGNER_RECORD_INVALID",
            "Creator display label is too long for the credential record.",
        )
    })?;
    let mut blob = Zeroizing::new(Vec::with_capacity(
        RECORD_MAGIC.len() + 4 + label.len() + 32 + 32,
    ));
    blob.extend_from_slice(RECORD_MAGIC);
    blob.push(RECORD_VERSION);
    blob.push(if record.disabled {
        RECORD_DISABLED
    } else {
        RECORD_ACTIVE
    });
    blob.extend_from_slice(&label_len.to_be_bytes());
    blob.extend_from_slice(label);
    blob.extend_from_slice(&record.public_key);
    if !record.disabled {
        let secret = record.secret_key.as_ref().ok_or_else(|| {
            CoreError::new(
                ErrorKind::CredentialStore,
                "SIGNER_RECORD_INVALID",
                "Active creator key record is missing private key bytes.",
            )
        })?;
        blob.extend_from_slice(secret.as_ref());
    }
    Ok(blob)
}

fn decode_record(blob: &[u8]) -> CoreResult<SignerRecord> {
    let header = RECORD_MAGIC.len() + 4;
    if blob.len() < header + 32 || !blob.starts_with(RECORD_MAGIC) {
        return Err(invalid_record());
    }
    let version = blob[RECORD_MAGIC.len()];
    let state = blob[RECORD_MAGIC.len() + 1];
    if version != RECORD_VERSION || !matches!(state, RECORD_ACTIVE | RECORD_DISABLED) {
        return Err(invalid_record());
    }
    let label_offset = RECORD_MAGIC.len() + 2;
    let label_len = u16::from_be_bytes([blob[label_offset], blob[label_offset + 1]]) as usize;
    let label_start = label_offset + 2;
    let public_start = label_start
        .checked_add(label_len)
        .ok_or_else(invalid_record)?;
    let expected = public_start + 32 + usize::from(state == RECORD_ACTIVE) * 32;
    if blob.len() != expected {
        return Err(invalid_record());
    }
    let display_label = std::str::from_utf8(&blob[label_start..public_start])
        .map_err(|_| invalid_record())?
        .to_owned();
    validate_label(&display_label)?;
    let mut public_key = [0_u8; 32];
    public_key.copy_from_slice(&blob[public_start..public_start + 32]);
    let secret_key = if state == RECORD_ACTIVE {
        let mut secret = [0_u8; 32];
        secret.copy_from_slice(&blob[public_start + 32..]);
        let signing_key = SigningKey::from_bytes(&secret);
        if signing_key.verifying_key().to_bytes() != public_key {
            secret.zeroize();
            return Err(invalid_record());
        }
        Some(Zeroizing::new(secret))
    } else {
        None
    };
    Ok(SignerRecord {
        disabled: state == RECORD_DISABLED,
        display_label,
        public_key,
        secret_key,
    })
}

fn invalid_record() -> CoreError {
    CoreError::new(
        ErrorKind::CredentialStore,
        "SIGNER_RECORD_INVALID",
        "The operating-system credential record is malformed.",
    )
}

pub(crate) fn random_signature_id() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let result = hex_lower(&bytes);
    bytes.zeroize();
    result
}

pub(crate) fn sign_manifest(
    material: &SigningMaterial,
    manifest_bytes: &[u8],
) -> CoreResult<SignatureArtifacts> {
    let manifest_digest = Sha256::digest(manifest_bytes);
    let fingerprint_bytes = Sha256::digest(&material.public_key_cose);
    let protected = HeaderBuilder::new()
        .algorithm(iana::Algorithm::EdDSA)
        .key_id(fingerprint_bytes.to_vec())
        .build();
    let signing_key = SigningKey::from_bytes(&material.secret_key);
    let sign1 = CoseSign1Builder::new()
        .protected(protected)
        .create_detached_signature(&manifest_digest, CREATOR_SIGNATURE_AAD, |bytes| {
            signing_key.sign(bytes).to_bytes().to_vec()
        })
        .build();
    let signature_cose = sign1.to_tagged_vec().map_err(|error| {
        CoreError::new(
            ErrorKind::Signing,
            "CREATOR_SIGNATURE_ENCODING_FAILED",
            error.to_string(),
        )
    })?;
    Ok(SignatureArtifacts {
        public_key_cose: material.public_key_cose.clone(),
        signature_cose,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignatureVerification {
    pub state: SignatureAssurance,
    pub evidence: CreatorSignatureEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignatureFailure {
    pub state: SignatureAssurance,
    pub code: &'static str,
    pub message: String,
}

pub(crate) fn verify_manifest_signature(
    manifest_bytes: &[u8],
    descriptor: &CreatorSignatureDescriptor,
    public_key_bytes: &[u8],
    signature_bytes: &[u8],
    local_trust: LocalTrust,
) -> Result<SignatureVerification, SignatureFailure> {
    if descriptor.profile != CREATOR_SIGNATURE_PROFILE {
        return Err(signature_failure(
            SignatureAssurance::Unsupported,
            "CREATOR_SIGNATURE_PROFILE_UNSUPPORTED",
            "Creator signature profile is unsupported.",
        ));
    }
    let (public_key, verifying_key) = parse_public_key(public_key_bytes)?;
    if sha256_hex(public_key_bytes) != descriptor.key_fingerprint {
        return Err(signature_failure(
            SignatureAssurance::Invalid,
            "CREATOR_KEY_FINGERPRINT_MISMATCH",
            "Public key bytes do not match the Manifest fingerprint.",
        ));
    }
    let canonical_key = public_key.to_vec().map_err(|error| {
        signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_KEY_MALFORMED",
            error.to_string(),
        )
    })?;
    if canonical_key != public_key_bytes {
        return Err(signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_KEY_NON_DETERMINISTIC",
            "COSE_Key is not in the deterministic protocol encoding.",
        ));
    }

    let sign1 = CoseSign1::from_tagged_slice(signature_bytes).map_err(|error| {
        signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_MALFORMED",
            error.to_string(),
        )
    })?;
    let canonical_sign1 = sign1.clone().to_tagged_vec().map_err(|error| {
        signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_MALFORMED",
            error.to_string(),
        )
    })?;
    if canonical_sign1 != signature_bytes {
        return Err(signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_NON_DETERMINISTIC",
            "COSE_Sign1 is not in the deterministic protocol encoding.",
        ));
    }
    if sign1.payload.is_some() {
        return Err(signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_EMBEDDED_PAYLOAD",
            "Creator signature payload must be detached nil.",
        ));
    }
    if !sign1.unprotected.is_empty() {
        return Err(signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_UNPROTECTED_HEADER",
            "Creator signature unprotected header must be empty.",
        ));
    }
    let protected = &sign1.protected.header;
    if protected.alg != Some(RegisteredLabelWithPrivate::Assigned(iana::Algorithm::EdDSA)) {
        return Err(signature_failure(
            SignatureAssurance::Unsupported,
            "CREATOR_SIGNATURE_ALGORITHM_UNSUPPORTED",
            "Creator signature protected algorithm must be EdDSA (-8).",
        ));
    }
    let expected_kid = Sha256::digest(public_key_bytes);
    if protected.key_id != expected_kid.as_slice() {
        return Err(signature_failure(
            SignatureAssurance::Invalid,
            "CREATOR_SIGNATURE_KID_MISMATCH",
            "Creator signature kid does not match the public key fingerprint.",
        ));
    }
    let mut expected_header = protected.clone();
    expected_header.alg = None;
    expected_header.key_id.clear();
    if !expected_header.is_empty() {
        return Err(signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_PROTECTED_HEADER_EXTRA",
            "Creator signature protected header contains unsupported fields.",
        ));
    }
    let canonical_protected = protected.clone().to_vec().map_err(|error| {
        signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_MALFORMED",
            error.to_string(),
        )
    })?;
    if sign1.protected.original_data.as_deref() != Some(canonical_protected.as_slice()) {
        return Err(signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_PROTECTED_NON_DETERMINISTIC",
            "Protected header is not in the deterministic protocol encoding.",
        ));
    }
    if sign1.signature.len() != 64 {
        return Err(signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_LENGTH_INVALID",
            "Ed25519 signature must contain exactly 64 bytes.",
        ));
    }
    let signature = Signature::from_slice(&sign1.signature).map_err(|error| {
        signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_SIGNATURE_LENGTH_INVALID",
            error.to_string(),
        )
    })?;
    let manifest_digest = Sha256::digest(manifest_bytes);
    let tbs = sign1.tbs_detached_data(&manifest_digest, CREATOR_SIGNATURE_AAD);
    verifying_key.verify_strict(&tbs, &signature).map_err(|_| {
        signature_failure(
            SignatureAssurance::Invalid,
            "CREATOR_SIGNATURE_INVALID",
            "Creator signature does not validate for this canonical Manifest.",
        )
    })?;
    let state = match local_trust {
        LocalTrust::Trusted => SignatureAssurance::ValidLocallyTrusted,
        LocalTrust::Disabled => SignatureAssurance::Disabled,
        LocalTrust::Untrusted => SignatureAssurance::ValidUntrusted,
    };
    Ok(SignatureVerification {
        state,
        evidence: CreatorSignatureEvidence {
            display_label: descriptor.display_label.clone(),
            key_fingerprint: descriptor.key_fingerprint.clone(),
            profile: descriptor.profile.clone(),
            local_trust,
        },
    })
}

fn parse_public_key(bytes: &[u8]) -> Result<(CoseKey, VerifyingKey), SignatureFailure> {
    let key = CoseKey::from_slice(bytes).map_err(|error| {
        signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_KEY_MALFORMED",
            error.to_string(),
        )
    })?;
    if key.kty != KeyType::Assigned(iana::KeyType::OKP)
        || key.alg != Some(Algorithm::Assigned(iana::Algorithm::EdDSA))
        || !key.key_id.is_empty()
        || !key.key_ops.is_empty()
        || !key.base_iv.is_empty()
        || key.params.len() != 2
    {
        return Err(signature_failure(
            SignatureAssurance::Unsupported,
            "CREATOR_KEY_PROFILE_UNSUPPORTED",
            "COSE_Key must contain only OKP, EdDSA, Ed25519 curve and x parameters.",
        ));
    }
    if key.params[0]
        != (
            Label::Int(iana::OkpKeyParameter::Crv as i64),
            CborValue::Integer((iana::EllipticCurve::Ed25519 as i64).into()),
        )
    {
        return Err(signature_failure(
            SignatureAssurance::Unsupported,
            "CREATOR_KEY_CURVE_UNSUPPORTED",
            "COSE_Key curve must be Ed25519 (6).",
        ));
    }
    let x = match &key.params[1] {
        (Label::Int(label), CborValue::Bytes(value))
            if *label == iana::OkpKeyParameter::X as i64 && value.len() == 32 =>
        {
            value
        }
        _ => {
            return Err(signature_failure(
                SignatureAssurance::Malformed,
                "CREATOR_KEY_X_INVALID",
                "COSE_Key x parameter must contain exactly 32 bytes.",
            ));
        }
    };
    let mut public = [0_u8; 32];
    public.copy_from_slice(x);
    let verifying_key = VerifyingKey::from_bytes(&public).map_err(|_| {
        signature_failure(
            SignatureAssurance::Malformed,
            "CREATOR_KEY_X_INVALID",
            "COSE_Key x parameter is not a valid Ed25519 public key.",
        )
    })?;
    Ok((key, verifying_key))
}

fn deterministic_public_key(public_key: &[u8; 32]) -> CoreResult<Vec<u8>> {
    CoseKeyBuilder::new_okp_key()
        .algorithm(iana::Algorithm::EdDSA)
        .param(
            iana::OkpKeyParameter::Crv as i64,
            CborValue::Integer((iana::EllipticCurve::Ed25519 as i64).into()),
        )
        .param(
            iana::OkpKeyParameter::X as i64,
            CborValue::Bytes(public_key.to_vec()),
        )
        .build()
        .to_vec()
        .map_err(|error| {
            CoreError::new(
                ErrorKind::Signing,
                "CREATOR_KEY_ENCODING_FAILED",
                error.to_string(),
            )
        })
}

fn signature_failure(
    state: SignatureAssurance,
    code: &'static str,
    message: impl Into<String>,
) -> SignatureFailure {
    SignatureFailure {
        state,
        code,
        message: message.into(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(HEX[(byte >> 4) as usize] as char);
        result.push(HEX[(byte & 0x0f) as usize] as char);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

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

    #[test]
    fn signer_lifecycle_and_signature_are_private_and_deterministic() {
        let service = SignerService::new(MemoryStore::default());
        assert_eq!(service.status().state, LocalSignerState::Missing);
        let created = service.create("Creator 甲").unwrap();
        assert_eq!(created.state, LocalSignerState::Active);
        assert_eq!(created.key_fingerprint.as_ref().unwrap().len(), 64);
        assert_eq!(created.warning_codes.len(), 1);

        let material = service.signing_material().unwrap();
        let manifest = br#"{"spec_version":"0.3.0"}"#;
        let artifacts = sign_manifest(&material, manifest).unwrap();
        let descriptor = CreatorSignatureDescriptor {
            profile: CREATOR_SIGNATURE_PROFILE.to_owned(),
            signature_id: "a".repeat(64),
            display_label: material.display_label.clone(),
            key_fingerprint: material.key_fingerprint.clone(),
            public_key_path: format!("security/keys/{}.cbor", material.key_fingerprint),
            signature_path: "security/signatures/creator.cose".to_owned(),
        };
        let verified = verify_manifest_signature(
            manifest,
            &descriptor,
            &artifacts.public_key_cose,
            &artifacts.signature_cose,
            LocalTrust::Trusted,
        )
        .unwrap();
        assert_eq!(verified.state, SignatureAssurance::ValidLocallyTrusted);

        let old_fingerprint = created.key_fingerprint.unwrap();
        let rotated = service.rotate("Creator B").unwrap();
        assert_ne!(rotated.key_fingerprint.unwrap(), old_fingerprint);
        assert_eq!(service.disable().unwrap().state, LocalSignerState::Disabled);
        let disabled_error = match service.signing_material() {
            Ok(_) => panic!("disabled signer unexpectedly returned private signing material"),
            Err(error) => error,
        };
        assert_eq!(disabled_error.code, "SIGNER_KEY_DISABLED");
        service.cleanup().unwrap();
        assert_eq!(service.status().state, LocalSignerState::Missing);
    }

    #[test]
    fn signature_rejects_manifest_and_key_substitution() {
        let service = SignerService::new(MemoryStore::default());
        service.create("Creator").unwrap();
        let material = service.signing_material().unwrap();
        let artifacts = sign_manifest(&material, b"manifest").unwrap();
        let descriptor = CreatorSignatureDescriptor {
            profile: CREATOR_SIGNATURE_PROFILE.to_owned(),
            signature_id: "b".repeat(64),
            display_label: "Creator".to_owned(),
            key_fingerprint: material.key_fingerprint,
            public_key_path: format!(
                "security/keys/{}.cbor",
                sha256_hex(&artifacts.public_key_cose)
            ),
            signature_path: "security/signatures/creator.cose".to_owned(),
        };
        assert_eq!(
            verify_manifest_signature(
                b"other",
                &descriptor,
                &artifacts.public_key_cose,
                &artifacts.signature_cose,
                LocalTrust::Untrusted,
            )
            .unwrap_err()
            .state,
            SignatureAssurance::Invalid
        );
        let mut key = artifacts.public_key_cose;
        *key.last_mut().unwrap() ^= 1;
        assert!(
            verify_manifest_signature(
                b"manifest",
                &descriptor,
                &key,
                &artifacts.signature_cose,
                LocalTrust::Untrusted,
            )
            .is_err()
        );
    }

    #[test]
    fn frozen_creator_signature_vector() {
        let secret_key = Zeroizing::new([0x11_u8; 32]);
        let signing_key = SigningKey::from_bytes(&secret_key);
        let public_key_cose =
            deterministic_public_key(&signing_key.verifying_key().to_bytes()).unwrap();
        let material = SigningMaterial {
            display_label: "Vector creator".to_owned(),
            key_fingerprint: sha256_hex(&public_key_cose),
            public_key_cose,
            secret_key,
        };
        let manifest = br#"{"created_at":"2026-07-15T00:00:00Z","spec_version":"0.3.0"}"#;
        let artifacts = sign_manifest(&material, manifest).unwrap();
        assert_eq!(
            hex_lower(&artifacts.public_key_cose),
            "a4010103272006215820d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"
        );
        assert_eq!(
            material.key_fingerprint,
            "7a7dc7970b353e5bae26d85fd764051dd6da735428d57957d2b1d18526320a00"
        );
        assert_eq!(
            hex_lower(&artifacts.signature_cose),
            "d2845826a201270458207a7dc7970b353e5bae26d85fd764051dd6da735428d57957d2b1d18526320a00a0f658404284bd5919c5087c9ba0455e96eac954a7863a663233c703a77984a8aabd83bf386fd7344ca59908948333d1814805a82671a608276a36d32b32c72cb74ff00b"
        );
    }

    #[test]
    fn signature_rejects_wrong_external_aad_and_algorithm() {
        let secret_key = Zeroizing::new([0x22_u8; 32]);
        let signing_key = SigningKey::from_bytes(&secret_key);
        let public_key_cose =
            deterministic_public_key(&signing_key.verifying_key().to_bytes()).unwrap();
        let descriptor = CreatorSignatureDescriptor {
            profile: CREATOR_SIGNATURE_PROFILE.to_owned(),
            signature_id: "c".repeat(64),
            display_label: "Negative vector".to_owned(),
            key_fingerprint: sha256_hex(&public_key_cose),
            public_key_path: format!("security/keys/{}.cbor", sha256_hex(&public_key_cose)),
            signature_path: "security/signatures/creator.cose".to_owned(),
        };
        let manifest = b"manifest";
        let digest = Sha256::digest(manifest);
        let protected = HeaderBuilder::new()
            .algorithm(iana::Algorithm::EdDSA)
            .key_id(Sha256::digest(&public_key_cose).to_vec())
            .build();
        let wrong_aad = CoseSign1Builder::new()
            .protected(protected)
            .create_detached_signature(&digest, b"wrong-domain", |bytes| {
                signing_key.sign(bytes).to_bytes().to_vec()
            })
            .build()
            .to_tagged_vec()
            .unwrap();
        assert_eq!(
            verify_manifest_signature(
                manifest,
                &descriptor,
                &public_key_cose,
                &wrong_aad,
                LocalTrust::Untrusted,
            )
            .unwrap_err()
            .code,
            "CREATOR_SIGNATURE_INVALID"
        );

        let wrong_algorithm = HeaderBuilder::new()
            .algorithm(iana::Algorithm::ES256)
            .key_id(Sha256::digest(&public_key_cose).to_vec())
            .build();
        let wrong_algorithm = CoseSign1Builder::new()
            .protected(wrong_algorithm)
            .create_detached_signature(&digest, CREATOR_SIGNATURE_AAD, |bytes| {
                signing_key.sign(bytes).to_bytes().to_vec()
            })
            .build()
            .to_tagged_vec()
            .unwrap();
        assert_eq!(
            verify_manifest_signature(
                manifest,
                &descriptor,
                &public_key_cose,
                &wrong_algorithm,
                LocalTrust::Untrusted,
            )
            .unwrap_err()
            .code,
            "CREATOR_SIGNATURE_ALGORITHM_UNSUPPORTED"
        );
    }

    #[test]
    fn rfc8032_ed25519_test_vector_one_matches() {
        let secret: [u8; 32] =
            decode_hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
                .try_into()
                .unwrap();
        let expected_public = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
        let expected_signature = concat!(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155",
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
        );
        let signing_key = SigningKey::from_bytes(&secret);
        assert_eq!(
            hex_lower(&signing_key.verifying_key().to_bytes()),
            expected_public
        );
        assert_eq!(
            hex_lower(&signing_key.sign(b"").to_bytes()),
            expected_signature
        );
    }

    #[test]
    fn signature_rejects_untagged_and_noncanonical_cbor() {
        let service = SignerService::new(MemoryStore::default());
        service.create("Canonical test").unwrap();
        let material = service.signing_material().unwrap();
        let artifacts = sign_manifest(&material, b"manifest").unwrap();
        let mut descriptor = CreatorSignatureDescriptor {
            profile: CREATOR_SIGNATURE_PROFILE.to_owned(),
            signature_id: "d".repeat(64),
            display_label: material.display_label,
            key_fingerprint: material.key_fingerprint,
            public_key_path: String::new(),
            signature_path: "security/signatures/creator.cose".to_owned(),
        };
        descriptor.public_key_path = format!("security/keys/{}.cbor", descriptor.key_fingerprint);

        let untagged = CoseSign1::from_tagged_slice(&artifacts.signature_cose)
            .unwrap()
            .to_vec()
            .unwrap();
        assert_eq!(
            verify_manifest_signature(
                b"manifest",
                &descriptor,
                &artifacts.public_key_cose,
                &untagged,
                LocalTrust::Untrusted,
            )
            .unwrap_err()
            .code,
            "CREATOR_SIGNATURE_MALFORMED"
        );

        let key = CoseKey::from_slice(&artifacts.public_key_cose).unwrap();
        let x = match &key.params[1].1 {
            CborValue::Bytes(value) => value,
            _ => unreachable!(),
        };
        let mut noncanonical_key = vec![
            0xa4, 0x18, 0x01, 0x01, 0x03, 0x27, 0x20, 0x06, 0x21, 0x58, 0x20,
        ];
        noncanonical_key.extend_from_slice(x);
        descriptor.key_fingerprint = sha256_hex(&noncanonical_key);
        descriptor.public_key_path = format!("security/keys/{}.cbor", descriptor.key_fingerprint);
        assert_eq!(
            verify_manifest_signature(
                b"manifest",
                &descriptor,
                &noncanonical_key,
                &artifacts.signature_cose,
                LocalTrust::Untrusted,
            )
            .unwrap_err()
            .code,
            "CREATOR_KEY_NON_DETERMINISTIC"
        );
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let pair = std::str::from_utf8(pair).unwrap();
                u8::from_str_radix(pair, 16).unwrap()
            })
            .collect()
    }
}
