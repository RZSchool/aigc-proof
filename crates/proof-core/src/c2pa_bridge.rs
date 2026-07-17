use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use c2pa::settings::Settings;
use c2pa::{
    Builder, BuilderIntent, Context, Error as C2paError, Reader, Signer, SigningAlg,
    ValidationState, assertions::DigitalSourceType,
};
use proof_schema::{
    C2PA_BRIDGE_PROFILE, C2PA_OBSERVATION_EVENT, C2paObservation, C2paSourceMode, C2paTrustProfile,
    C2paTrustSnapshot, C2paTrustState, C2paValidationState, Event, parse_canonical_rfc3339,
    parse_json_strict, validate_c2pa_profile_schema,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tempfile::Builder as TempBuilder;

use crate::asset_match::detect_image_media_type;
use crate::workspace::workspace_asset_path;
use crate::{
    CoreError, CoreResult, ErrorKind, RecordEventOptions, canonical_json, load_workspace,
    record_event, sha256_bytes, sha256_reader,
};

pub const C2PA_MAX_ASSET_BYTES: u64 = 128 * 1024 * 1024;
pub const C2PA_MAX_MANIFEST_BYTES: u64 = 32 * 1024 * 1024;
pub const C2PA_MAX_MANIFESTS: usize = 64;
pub const C2PA_MAX_ASSERTIONS: usize = 1024;
pub const C2PA_MAX_INGREDIENTS: usize = 256;
pub const C2PA_MAX_ELAPSED: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct ParsedC2paTrustProfile {
    pub profile: C2paTrustProfile,
    pub canonical_json: String,
    pub digest: String,
    pub signer_snapshot_sha256: String,
    pub timestamp_snapshot_sha256: String,
}

#[derive(Debug, Clone)]
pub struct C2paInspectOptions<'a> {
    pub asset_path: PathBuf,
    pub sidecar_path: Option<PathBuf>,
    pub trust_profile: &'a ParsedC2paTrustProfile,
    pub observed_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateC2paObservationOptions<'a> {
    pub workspace: PathBuf,
    pub asset_id: String,
    pub sidecar_path: Option<PathBuf>,
    pub trust_profile: &'a ParsedC2paTrustProfile,
    pub event_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct C2paInspection {
    pub profile: String,
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
    pub elapsed_ms: u64,
}

impl C2paInspection {
    fn into_observation(self, asset_id: String) -> C2paObservation {
        C2paObservation {
            profile: self.profile,
            asset_id,
            asset_sha256: self.asset_sha256,
            manifest_store_sha256: self.manifest_store_sha256,
            source_mode: self.source_mode,
            claim_version: self.claim_version,
            active_manifest: self.active_manifest,
            signer_trust_snapshot_sha256: self.signer_trust_snapshot_sha256,
            timestamp_trust_snapshot_sha256: self.timestamp_trust_snapshot_sha256,
            validation_state: self.validation_state,
            signer_trust: self.signer_trust,
            timestamp_trust: self.timestamp_trust,
            success_codes: self.success_codes,
            informational_codes: self.informational_codes,
            failure_codes: self.failure_codes,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum C2paSigningAlgorithm {
    Es256,
    Es384,
    Ps256,
}

impl C2paSigningAlgorithm {
    fn sdk(self) -> SigningAlg {
        match self {
            Self::Es256 => SigningAlg::Es256,
            Self::Es384 => SigningAlg::Es384,
            Self::Ps256 => SigningAlg::Ps256,
        }
    }
}

pub struct C2paHostSignRequest<'a> {
    pub algorithm: C2paSigningAlgorithm,
    pub to_be_signed: &'a [u8],
    pub to_be_signed_sha256: String,
}

pub trait C2paHostSigningCallback: Send + Sync {
    fn algorithm(&self) -> C2paSigningAlgorithm;
    fn certificate_chain_der(&self) -> CoreResult<Vec<Vec<u8>>>;
    fn reserve_size(&self) -> usize;
    fn sign(&self, request: C2paHostSignRequest<'_>) -> CoreResult<Vec<u8>>;
}

pub fn parse_c2pa_trust_profile(json_text: &str) -> CoreResult<ParsedC2paTrustProfile> {
    if json_text.len() > 4 * 1024 * 1024 {
        return Err(c2pa_error(
            "C2PA_TRUST_PROFILE_LIMIT_EXCEEDED",
            "C2PA trust profile exceeds the 4 MiB limit.",
        ));
    }
    let value = parse_json_strict(json_text.as_bytes()).map_err(|_| {
        c2pa_error(
            "C2PA_TRUST_PROFILE_JSON_INVALID",
            "C2PA trust profile JSON is malformed or ambiguous.",
        )
    })?;
    validate_c2pa_profile_schema(&value)
        .map_err(|errors| c2pa_error("C2PA_TRUST_PROFILE_SCHEMA_INVALID", errors.join("; ")))?;
    let profile: C2paTrustProfile = serde_json::from_value(value).map_err(|_| {
        c2pa_error(
            "C2PA_TRUST_PROFILE_MODEL_INVALID",
            "C2PA trust profile could not be decoded.",
        )
    })?;
    if let Some(issue) = profile.validate().into_iter().next() {
        return Err(c2pa_error(
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        ));
    }
    let canonical = canonical_json(&profile)?;
    let canonical_json = String::from_utf8(canonical.clone()).map_err(|_| {
        c2pa_error(
            "C2PA_TRUST_PROFILE_CANONICALIZATION_FAILED",
            "Canonical C2PA trust profile was not UTF-8.",
        )
    })?;
    Ok(ParsedC2paTrustProfile {
        signer_snapshot_sha256: sha256_bytes(&canonical_json_bytes(&profile.signer)?),
        timestamp_snapshot_sha256: sha256_bytes(&canonical_json_bytes(&profile.timestamp)?),
        digest: sha256_bytes(&canonical),
        canonical_json,
        profile,
    })
}

pub fn inspect_c2pa(options: C2paInspectOptions<'_>) -> CoreResult<C2paInspection> {
    validate_observation_time(&options.observed_at, options.trust_profile)?;
    let started = Instant::now();
    let mut asset = open_regular_bounded(&options.asset_path, C2PA_MAX_ASSET_BYTES, "C2PA_ASSET")?;
    let media_type = detect_image_media_type(&mut asset, &options.asset_path)?;
    asset
        .seek(SeekFrom::Start(0))
        .map_err(|error| CoreError::io("C2PA_ASSET_SEEK_FAILED", &options.asset_path, error))?;
    let asset_digest = sha256_reader(&mut asset)?;
    asset
        .seek(SeekFrom::Start(0))
        .map_err(|error| CoreError::io("C2PA_ASSET_SEEK_FAILED", &options.asset_path, error))?;

    let (source_mode, manifest_bytes) = match options.sidecar_path.as_ref() {
        Some(sidecar) => {
            if sidecar.extension().and_then(|value| value.to_str()) != Some("c2pa") {
                return Err(c2pa_error(
                    "C2PA_SIDECAR_EXTENSION_INVALID",
                    "Explicit sidecar must use the lowercase .c2pa extension.",
                )
                .at_path(sidecar));
            }
            let mut file = open_regular_bounded(sidecar, C2PA_MAX_MANIFEST_BYTES, "C2PA_SIDECAR")?;
            let bytes = read_bounded(
                &mut file,
                C2PA_MAX_MANIFEST_BYTES,
                "C2PA_MANIFEST_LIMIT_EXCEEDED",
            )?;
            (C2paSourceMode::Sidecar, bytes)
        }
        None => {
            let bytes = c2pa::jumbf_io::load_jumbf_from_stream(media_type, &mut asset)
                .map_err(map_c2pa_read_error)?;
            if bytes.is_empty() || bytes.len() as u64 > C2PA_MAX_MANIFEST_BYTES {
                return Err(c2pa_error(
                    "C2PA_MANIFEST_LIMIT_EXCEEDED",
                    "Embedded C2PA manifest store must contain 1 byte to 32 MiB.",
                ));
            }
            (C2paSourceMode::Embedded, bytes)
        }
    };

    asset
        .seek(SeekFrom::Start(0))
        .map_err(|error| CoreError::io("C2PA_ASSET_SEEK_FAILED", &options.asset_path, error))?;
    let signer_reader = read_with_snapshot(
        media_type,
        &manifest_bytes,
        &mut asset,
        &options.trust_profile.profile.signer,
        true,
        false,
        started,
    )?;
    enforce_reader_limits(&signer_reader)?;
    let claim_version = signer_reader
        .active_manifest()
        .and_then(|manifest| manifest.claim_version())
        .ok_or_else(|| {
            c2pa_error(
                "C2PA_CLAIM_VERSION_MISSING",
                "Active C2PA manifest does not declare a supported claim version.",
            )
        })?;
    if !matches!(claim_version, 1 | 2) {
        return Err(c2pa_error(
            "C2PA_CLAIM_VERSION_UNSUPPORTED",
            "Only C2PA claim versions 1 and 2 are supported; 2.3/2.4 behavior is not inferred.",
        ));
    }
    let active_manifest = signer_reader
        .active_label()
        .filter(|label| {
            !label.is_empty() && label.len() <= 512 && !label.chars().any(char::is_control)
        })
        .ok_or_else(|| {
            c2pa_error(
                "C2PA_ACTIVE_MANIFEST_INVALID",
                "C2PA active manifest label is missing or unsafe for bounded display.",
            )
        })?
        .to_owned();
    let (success_codes, informational_codes, failure_codes) =
        normalized_status_codes(&signer_reader);
    let signer_trust = match signer_reader.validation_state() {
        ValidationState::Trusted => C2paTrustState::Trusted,
        ValidationState::Valid | ValidationState::Invalid => C2paTrustState::Untrusted,
    };

    asset
        .seek(SeekFrom::Start(0))
        .map_err(|error| CoreError::io("C2PA_ASSET_SEEK_FAILED", &options.asset_path, error))?;
    let timestamp_reader = read_with_snapshot(
        media_type,
        &manifest_bytes,
        &mut asset,
        &options.trust_profile.profile.timestamp,
        false,
        true,
        started,
    )?;
    asset
        .seek(SeekFrom::Start(0))
        .map_err(|error| CoreError::io("C2PA_ASSET_SEEK_FAILED", &options.asset_path, error))?;
    let final_asset_digest = sha256_reader(&mut asset)?;
    if final_asset_digest != asset_digest {
        return Err(c2pa_error(
            "C2PA_ASSET_CHANGED_DURING_READ",
            "C2PA asset bytes changed while the manifest was being inspected.",
        )
        .at_path(&options.asset_path));
    }
    let timestamp_codes = all_status_codes(&timestamp_reader)
        .into_iter()
        .filter(|code| code.to_ascii_lowercase().contains("timestamp"))
        .collect::<Vec<_>>();
    let timestamp_trust = if timestamp_codes.is_empty() {
        C2paTrustState::NotEvaluated
    } else if timestamp_codes
        .iter()
        .any(|code| code.eq_ignore_ascii_case("timeStamp.trusted"))
    {
        C2paTrustState::Trusted
    } else {
        C2paTrustState::Untrusted
    };
    let validation_state = match signer_reader.validation_state() {
        ValidationState::Invalid => C2paValidationState::Invalid,
        ValidationState::Valid => C2paValidationState::ValidUntrusted,
        ValidationState::Trusted => C2paValidationState::Trusted,
    };
    let elapsed = started.elapsed();
    if elapsed > C2PA_MAX_ELAPSED {
        return Err(c2pa_error(
            "C2PA_TIME_LIMIT_EXCEEDED",
            "C2PA inspection exceeded the 30 second processing limit.",
        ));
    }
    Ok(C2paInspection {
        profile: C2PA_BRIDGE_PROFILE.to_owned(),
        asset_sha256: asset_digest.sha256,
        manifest_store_sha256: sha256_bytes(&manifest_bytes),
        source_mode,
        claim_version,
        active_manifest,
        signer_trust_snapshot_sha256: options.trust_profile.signer_snapshot_sha256.clone(),
        timestamp_trust_snapshot_sha256: options.trust_profile.timestamp_snapshot_sha256.clone(),
        validation_state,
        signer_trust,
        timestamp_trust,
        success_codes,
        informational_codes,
        failure_codes,
        elapsed_ms: elapsed.as_millis().min(u64::MAX as u128) as u64,
    })
}

pub fn create_c2pa_observation(options: CreateC2paObservationOptions<'_>) -> CoreResult<Event> {
    let workspace = load_workspace(&options.workspace)?;
    let asset = workspace
        .assets
        .iter()
        .find(|asset| asset.asset_id == options.asset_id)
        .ok_or_else(|| {
            c2pa_error(
                "C2PA_ASSET_NOT_FOUND",
                "C2PA observation asset is not present in the workspace.",
            )
        })?;
    let path = workspace_asset_path(&options.workspace, asset)?;
    let inspection = inspect_c2pa(C2paInspectOptions {
        asset_path: path,
        sidecar_path: options.sidecar_path,
        trust_profile: options.trust_profile,
        observed_at: options.created_at.clone(),
    })?;
    if inspection.asset_sha256 != asset.sha256 {
        return Err(c2pa_error(
            "C2PA_ASSET_DIGEST_MISMATCH",
            "Inspected image bytes do not match the recorded workspace asset.",
        ));
    }
    let observation = inspection.into_observation(options.asset_id);
    if let Some(issue) = observation.validate().into_iter().next() {
        return Err(c2pa_error(
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        ));
    }
    let payload = serde_json::to_value(observation).map_err(|_| {
        c2pa_error(
            "C2PA_OBSERVATION_ENCODING_FAILED",
            "C2PA observation could not be encoded.",
        )
    })?;
    record_event(RecordEventOptions {
        workspace: options.workspace,
        event_id: options.event_id,
        event_type: C2PA_OBSERVATION_EVENT.to_owned(),
        created_at: options.created_at,
        payload,
    })
}

pub fn sign_c2pa_with_host_callback(
    source: &Path,
    output: &Path,
    callback: &dyn C2paHostSigningCallback,
) -> CoreResult<()> {
    if output.exists() {
        return Err(c2pa_error(
            "C2PA_OUTPUT_ALREADY_EXISTS",
            "C2PA signing output already exists and will not be overwritten.",
        )
        .at_path(output));
    }
    let mut source_file = open_regular_bounded(source, C2PA_MAX_ASSET_BYTES, "C2PA_SIGN_SOURCE")?;
    let media_type = detect_image_media_type(&mut source_file, source)?;
    source_file
        .seek(SeekFrom::Start(0))
        .map_err(|error| CoreError::io("C2PA_ASSET_SEEK_FAILED", source, error))?;
    let certificates = callback.certificate_chain_der()?;
    if certificates.is_empty()
        || certificates.len() > 8
        || certificates
            .iter()
            .any(|certificate| certificate.is_empty() || certificate.len() > 256 * 1024)
    {
        return Err(c2pa_error(
            "C2PA_SIGNER_CERTIFICATES_INVALID",
            "Host signer must provide one to eight bounded DER certificates.",
        ));
    }
    let reserve_size = callback.reserve_size();
    if !(64..=32 * 1024).contains(&reserve_size) {
        return Err(c2pa_error(
            "C2PA_SIGNER_RESERVE_INVALID",
            "Host signer reserve size must be between 64 bytes and 32 KiB.",
        ));
    }
    let parent = output.parent().ok_or_else(|| {
        c2pa_error(
            "C2PA_OUTPUT_PATH_INVALID",
            "C2PA signing output has no parent directory.",
        )
    })?;
    require_regular_directory(parent)?;
    let mut temporary = TempBuilder::new()
        .prefix(".aigc-proof-c2pa-")
        .tempfile_in(parent)
        .map_err(|error| CoreError::io("C2PA_TEMPORARY_FILE_FAILED", parent, error))?;
    let signer = CallbackSigner {
        callback,
        certificates,
        reserve_size,
    };
    let definition = json!({
        "claim_version": 2,
        "claim_generator_info": [{"name": "AIGC-Proof host callback", "version": "1.0.0"}]
    });
    let signing_context = Context::new()
        .with_settings(json!({
            "core": {"allowed_network_hosts": []},
            "verify": {"ocsp_fetch": false, "remote_manifest_fetch": false}
        }))
        .map_err(|_| {
            c2pa_error(
                "C2PA_BUILDER_FAILED",
                "C2PA offline signing context could not be initialized.",
            )
        })?;
    let mut builder = Builder::from_context(signing_context)
        .with_definition(definition)
        .map_err(|_| {
            c2pa_error(
                "C2PA_BUILDER_FAILED",
                "C2PA claim-v2 builder could not be initialized.",
            )
        })?;
    builder.set_intent(BuilderIntent::Create(
        DigitalSourceType::TrainedAlgorithmicMedia,
    ));
    builder
        .sign(
            &signer,
            media_type,
            &mut source_file,
            temporary.as_file_mut(),
        )
        .map_err(|_| {
            c2pa_error(
                "C2PA_HOST_SIGNING_FAILED",
                "Host callback or C2PA claim-v2 signing failed.",
            )
        })?;
    let output_len = temporary
        .as_file()
        .metadata()
        .map_err(|error| CoreError::io("C2PA_OUTPUT_METADATA_FAILED", temporary.path(), error))?
        .len();
    if output_len == 0 || output_len > C2PA_MAX_ASSET_BYTES + C2PA_MAX_MANIFEST_BYTES {
        return Err(c2pa_error(
            "C2PA_OUTPUT_LIMIT_EXCEEDED",
            "Signed C2PA output exceeds its bounded size limit.",
        ));
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CoreError::io("C2PA_OUTPUT_SYNC_FAILED", temporary.path(), error))?;
    temporary
        .persist_noclobber(output)
        .map_err(|error| CoreError::io("C2PA_OUTPUT_PERSIST_FAILED", output, error.error))?;
    Ok(())
}

struct CallbackSigner<'a> {
    callback: &'a dyn C2paHostSigningCallback,
    certificates: Vec<Vec<u8>>,
    reserve_size: usize,
}

impl Signer for CallbackSigner<'_> {
    fn sign(&self, data: &[u8]) -> c2pa::Result<Vec<u8>> {
        if data.is_empty() || data.len() > 8 * 1024 * 1024 {
            return Err(C2paError::BadParam(
                "bounded host signing input rejected".to_owned(),
            ));
        }
        let signature = self
            .callback
            .sign(C2paHostSignRequest {
                algorithm: self.callback.algorithm(),
                to_be_signed: data,
                to_be_signed_sha256: sha256_bytes(data),
            })
            .map_err(|_| C2paError::BadParam("host signing callback failed".to_owned()))?;
        if signature.is_empty() || signature.len() > self.reserve_size {
            return Err(C2paError::BadParam(
                "host signature exceeded its declared bound".to_owned(),
            ));
        }
        Ok(signature)
    }

    fn alg(&self) -> SigningAlg {
        self.callback.algorithm().sdk()
    }

    fn certs(&self) -> c2pa::Result<Vec<Vec<u8>>> {
        Ok(self.certificates.clone())
    }

    fn reserve_size(&self) -> usize {
        self.reserve_size
    }
}

fn read_with_snapshot(
    media_type: &str,
    manifest_bytes: &[u8],
    asset: &mut File,
    snapshot: &C2paTrustSnapshot,
    verify_signer_trust: bool,
    verify_timestamp_trust: bool,
    started: Instant,
) -> CoreResult<Reader> {
    let trust_anchors = snapshot.trust_anchors_pem.join("");
    let trust_config = format!("{}\n", snapshot.allowed_ekus.join("\n"));
    let settings = Settings::new()
        .with_json(
            &json!({
                "core": {
                    "backing_store_memory_threshold_in_mb": 32,
                    "decode_identity_assertions": false,
                    "allowed_network_hosts": []
                },
                "verify": {
                    "verify_after_reading": true,
                    "verify_trust": verify_signer_trust,
                    "verify_timestamp_trust": verify_timestamp_trust,
                    "ocsp_fetch": false,
                    "remote_manifest_fetch": false,
                    "strict_v1_validation": false
                },
                "trust": {
                    "trust_anchors": trust_anchors,
                    "trust_config": trust_config
                }
            })
            .to_string(),
        )
        .map_err(|_| {
            c2pa_error(
                "C2PA_TRUST_SETTINGS_INVALID",
                "C2PA SDK rejected the explicit offline trust settings.",
            )
        })?;
    let context = Context::new()
        .with_settings(settings)
        .map_err(|_| {
            c2pa_error(
                "C2PA_CONTEXT_FAILED",
                "C2PA validation context could not be initialized.",
            )
        })?
        .with_progress_callback(move |_, _, _| started.elapsed() <= C2PA_MAX_ELAPSED);
    Reader::from_context(context)
        .with_manifest_data_and_stream(manifest_bytes, media_type, asset)
        .map_err(map_c2pa_read_error)
}

fn enforce_reader_limits(reader: &Reader) -> CoreResult<()> {
    if reader.manifests().len() > C2PA_MAX_MANIFESTS {
        return Err(c2pa_error(
            "C2PA_MANIFEST_COUNT_LIMIT_EXCEEDED",
            "C2PA manifest count exceeds 64.",
        ));
    }
    let assertion_count = reader
        .iter_manifests()
        .map(|manifest| manifest.assertions().len())
        .sum::<usize>();
    if assertion_count > C2PA_MAX_ASSERTIONS {
        return Err(c2pa_error(
            "C2PA_ASSERTION_LIMIT_EXCEEDED",
            "C2PA assertion count exceeds 1024.",
        ));
    }
    if reader.iter_manifests().any(|manifest| {
        manifest
            .assertions()
            .iter()
            .any(|assertion| assertion.label().starts_with("c2pa.soft-binding"))
    }) {
        return Err(c2pa_error(
            "C2PA_SOFT_BINDING_UNSUPPORTED",
            "C2PA soft-binding assertions are outside the protocol 0.5 bridge profile.",
        ));
    }
    let ingredient_count = reader
        .iter_manifests()
        .map(|manifest| manifest.ingredients().len())
        .sum::<usize>();
    if ingredient_count > C2PA_MAX_INGREDIENTS {
        return Err(c2pa_error(
            "C2PA_INGREDIENT_LIMIT_EXCEEDED",
            "C2PA ingredient count exceeds 256.",
        ));
    }
    Ok(())
}

fn normalized_status_codes(reader: &Reader) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut success = Vec::new();
    let mut informational = Vec::new();
    let mut failure = Vec::new();
    if let Some(results) = reader.validation_results() {
        if let Some(codes) = results.active_manifest() {
            success.extend(
                codes
                    .success()
                    .iter()
                    .map(|status| status.code().to_owned()),
            );
            informational.extend(
                codes
                    .informational()
                    .iter()
                    .map(|status| status.code().to_owned()),
            );
            failure.extend(
                codes
                    .failure()
                    .iter()
                    .map(|status| status.code().to_owned()),
            );
        }
        if let Some(deltas) = results.ingredient_deltas() {
            for delta in deltas {
                let codes = delta.validation_deltas();
                success.extend(
                    codes
                        .success()
                        .iter()
                        .map(|status| status.code().to_owned()),
                );
                informational.extend(
                    codes
                        .informational()
                        .iter()
                        .map(|status| status.code().to_owned()),
                );
                failure.extend(
                    codes
                        .failure()
                        .iter()
                        .map(|status| status.code().to_owned()),
                );
            }
        }
    } else if let Some(statuses) = reader.validation_status() {
        for status in statuses {
            if status.passed() {
                success.push(status.code().to_owned());
            } else {
                failure.push(status.code().to_owned());
            }
        }
    }
    normalize_codes(&mut success);
    normalize_codes(&mut informational);
    normalize_codes(&mut failure);
    (success, informational, failure)
}

fn all_status_codes(reader: &Reader) -> Vec<String> {
    let (success, informational, failure) = normalized_status_codes(reader);
    success
        .into_iter()
        .chain(informational)
        .chain(failure)
        .collect()
}

fn normalize_codes(codes: &mut Vec<String>) {
    codes.retain(|code| {
        !code.is_empty()
            && code.len() <= 128
            && code.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':')
            })
    });
    codes.sort();
    codes.dedup();
    codes.truncate(256);
}

fn validate_observation_time(
    observed_at: &str,
    profile: &ParsedC2paTrustProfile,
) -> CoreResult<()> {
    let observed = parse_canonical_rfc3339(observed_at).map_err(|_| {
        c2pa_error(
            "C2PA_OBSERVATION_TIME_INVALID",
            "C2PA observation time must be canonical UTC RFC 3339.",
        )
    })?;
    for (name, snapshot) in [
        ("signer", &profile.profile.signer),
        ("timestamp", &profile.profile.timestamp),
    ] {
        let effective = parse_canonical_rfc3339(&snapshot.effective_at).map_err(|_| {
            c2pa_error(
                "C2PA_TRUST_TIME_INVALID",
                "C2PA trust snapshot effective time is invalid.",
            )
        })?;
        let expires = parse_canonical_rfc3339(&snapshot.expires_at).map_err(|_| {
            c2pa_error(
                "C2PA_TRUST_TIME_INVALID",
                "C2PA trust snapshot expiry time is invalid.",
            )
        })?;
        if observed < effective || observed >= expires {
            return Err(c2pa_error(
                "C2PA_TRUST_SNAPSHOT_NOT_EFFECTIVE",
                format!("C2PA {name} trust snapshot is not effective at observation time."),
            ));
        }
    }
    Ok(())
}

fn open_regular_bounded(path: &Path, max_bytes: u64, kind: &'static str) -> CoreResult<File> {
    let (metadata_code, open_code) = match kind {
        "C2PA_ASSET" => ("C2PA_ASSET_METADATA_FAILED", "C2PA_ASSET_OPEN_FAILED"),
        "C2PA_SIDECAR" => ("C2PA_SIDECAR_METADATA_FAILED", "C2PA_SIDECAR_OPEN_FAILED"),
        "C2PA_SIGN_SOURCE" => (
            "C2PA_SIGN_SOURCE_METADATA_FAILED",
            "C2PA_SIGN_SOURCE_OPEN_FAILED",
        ),
        _ => ("C2PA_INPUT_METADATA_FAILED", "C2PA_INPUT_OPEN_FAILED"),
    };
    let metadata =
        fs::symlink_metadata(path).map_err(|error| CoreError::io(metadata_code, path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(c2pa_error(
            "C2PA_INPUT_NOT_REGULAR_FILE",
            "C2PA inputs must be regular files and not symbolic links.",
        )
        .at_path(path));
    }
    if metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(c2pa_error(
            "C2PA_INPUT_LIMIT_EXCEEDED",
            "C2PA input is empty or exceeds its configured byte limit.",
        )
        .at_path(path));
    }
    File::open(path).map_err(|error| CoreError::io(open_code, path, error))
}

fn read_bounded(file: &mut File, max_bytes: u64, code: &'static str) -> CoreResult<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| c2pa_error(code, error.to_string()))?;
    if bytes.is_empty() || bytes.len() as u64 > max_bytes {
        return Err(c2pa_error(
            code,
            "C2PA manifest store is empty or exceeds 32 MiB.",
        ));
    }
    Ok(bytes)
}

fn require_regular_directory(path: &Path) -> CoreResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| CoreError::io("C2PA_OUTPUT_DIRECTORY_INVALID", path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(c2pa_error(
            "C2PA_OUTPUT_DIRECTORY_INVALID",
            "C2PA output parent must be a real directory.",
        )
        .at_path(path));
    }
    Ok(())
}

fn canonical_json_bytes(value: &impl Serialize) -> CoreResult<Vec<u8>> {
    canonical_json(value)
}

fn map_c2pa_read_error(error: C2paError) -> CoreError {
    match error {
        C2paError::RemoteManifestUrl(_) | C2paError::RemoteManifestFetch(_) => c2pa_error(
            "C2PA_REMOTE_MANIFEST_UNSUPPORTED",
            "Remote C2PA manifests are unsupported and were not fetched.",
        ),
        C2paError::JumbfNotFound => c2pa_error(
            "C2PA_MANIFEST_NOT_FOUND",
            "No embedded C2PA manifest was found; select an explicit local .c2pa sidecar if available.",
        ),
        C2paError::UnsupportedType => c2pa_error(
            "C2PA_MEDIA_TYPE_UNSUPPORTED",
            "Only JPEG, PNG and WebP C2PA assets are supported.",
        ),
        C2paError::ClaimVersion => c2pa_error(
            "C2PA_CLAIM_VERSION_UNSUPPORTED",
            "The C2PA claim version is outside the protocol 0.5 / C2PA 2.2 bridge profile.",
        ),
        C2paError::InvalidClaim(error)
            if matches!(
                error.to_string().as_str(),
                "claim version is too new, not supported"
                    | "claim version does not match JUMBF box label"
            ) =>
        {
            c2pa_error(
                "C2PA_CLAIM_VERSION_UNSUPPORTED",
                "The C2PA claim version is outside the protocol 0.5 / C2PA 2.2 bridge profile.",
            )
        }
        C2paError::TooManyAssertions { .. } => c2pa_error(
            "C2PA_ASSERTION_LIMIT_EXCEEDED",
            "C2PA SDK rejected an excessive assertion count.",
        ),
        C2paError::TooManyManifestStores => c2pa_error(
            "C2PA_MANIFEST_COUNT_LIMIT_EXCEEDED",
            "C2PA SDK rejected multiple or excessive manifest stores.",
        ),
        C2paError::OperationCancelled => c2pa_error(
            "C2PA_TIME_LIMIT_EXCEEDED",
            "C2PA processing was cancelled after reaching its time limit.",
        ),
        _ => c2pa_error(
            "C2PA_VALIDATION_REJECTED",
            "C2PA SDK rejected malformed, unsupported or unsafe manifest data.",
        ),
    }
}

fn c2pa_error(code: &'static str, message: impl Into<String>) -> CoreError {
    CoreError::new(ErrorKind::PackageFormat, code, message)
}
