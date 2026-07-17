use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use proof_schema::{
    Assurance, C2PA_OBSERVATION_EVENT, C2PA_SCHEMA_VERSION, C2paAssurance, C2paEvidence,
    C2paObservation, C2paValidationState, CheckResult, CheckStatus, CreatorSignatureEvidence,
    EVENTS_PATH, Event, IdentityAssurance, Inspection, InternalIntegrity, LEGACY_SCHEMA_VERSION,
    LocalTrust, MANIFEST_PATH, Manifest, RevocationEvidenceState, SCHEMA_VERSION,
    SIGNED_SCHEMA_VERSION, SignatureAssurance, TRUSTED_SCHEMA_VERSION, TRUSTED_TIMESTAMP_PROFILE,
    TimeAssurance, TrustedTimeEvidence, VerificationError, VerificationReport, VerificationStatus,
    VerificationWarning, display_label_needs_confusable_warning, parse_json_strict,
    validate_event_schema, validate_manifest_schema, validate_package_path, validate_proof_id,
};
use serde_json::Value;
use zip::{CompressionMethod, ZipArchive};

use crate::signing::{SignatureFailure, SignerKeyStore, SignerService, verify_manifest_signature};
use crate::timestamp::{ParsedTsaProfile, verify_timestamp_strict};
use crate::{CoreError, CoreResult, ErrorKind, canonical_json, sha256_reader, verify_event_chain};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationLimits {
    pub max_package_bytes: u64,
    pub max_entries: usize,
    pub max_manifest_bytes: u64,
    pub max_event_bytes: u64,
    pub max_public_key_bytes: u64,
    pub max_signature_bytes: u64,
    pub max_timestamp_response_bytes: u64,
    pub max_total_uncompressed_bytes: u64,
    pub max_single_entry_bytes: u64,
    pub max_compression_ratio: u64,
}

impl Default for VerificationLimits {
    fn default() -> Self {
        Self {
            max_package_bytes: 2 * 1024 * 1024 * 1024,
            max_entries: 1024,
            max_manifest_bytes: 1024 * 1024,
            max_event_bytes: 16 * 1024 * 1024,
            max_public_key_bytes: 256,
            max_signature_bytes: 1024,
            max_timestamp_response_bytes: 1024 * 1024,
            max_total_uncompressed_bytes: 2 * 1024 * 1024 * 1024,
            max_single_entry_bytes: 512 * 1024 * 1024,
            max_compression_ratio: 100,
        }
    }
}

#[derive(Debug, Clone)]
struct EntryMetadata {
    index: usize,
    name: String,
    size: u64,
}

pub fn verify_package(
    path: &Path,
    limits: &VerificationLimits,
    verified_at: String,
) -> VerificationReport {
    verify_package_internal(path, limits, verified_at, &|_| LocalTrust::Untrusted, None).0
}

pub fn verify_package_with_profile(
    path: &Path,
    limits: &VerificationLimits,
    verified_at: String,
    profile: &ParsedTsaProfile,
) -> VerificationReport {
    verify_package_internal(
        path,
        limits,
        verified_at,
        &|_| LocalTrust::Untrusted,
        Some(profile),
    )
    .0
}

pub fn verify_package_with_signer<S: SignerKeyStore>(
    path: &Path,
    limits: &VerificationLimits,
    verified_at: String,
    signer: &SignerService<S>,
) -> VerificationReport {
    verify_package_internal(
        path,
        limits,
        verified_at,
        &|fingerprint| signer.trust_for(fingerprint),
        None,
    )
    .0
}

pub fn verify_package_with_signer_and_profile<S: SignerKeyStore>(
    path: &Path,
    limits: &VerificationLimits,
    verified_at: String,
    signer: &SignerService<S>,
    profile: &ParsedTsaProfile,
) -> VerificationReport {
    verify_package_internal(
        path,
        limits,
        verified_at,
        &|fingerprint| signer.trust_for(fingerprint),
        Some(profile),
    )
    .0
}

pub(crate) fn verify_package_with_manifest(
    path: &Path,
    limits: &VerificationLimits,
    verified_at: String,
) -> (VerificationReport, Option<Manifest>) {
    verify_package_internal(path, limits, verified_at, &|_| LocalTrust::Untrusted, None)
}

fn verify_package_internal(
    path: &Path,
    limits: &VerificationLimits,
    verified_at: String,
    trust: &dyn Fn(&str) -> LocalTrust,
    tsa_profile: Option<&ParsedTsaProfile>,
) -> (VerificationReport, Option<Manifest>) {
    let verification_timestamp_valid =
        proof_schema::validate_canonical_timestamp(&verified_at).is_ok();
    let mut report = ReportBuilder::new(verified_at);
    if !verification_timestamp_valid {
        report.operational_error = true;
        report.error(
            "INVALID_VERIFICATION_TIMESTAMP",
            None,
            "Verification timestamp is not canonical UTC RFC 3339.",
        );
        return (report.finish(), None);
    }
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) => {
            report.operational_error = true;
            report.error(
                "PACKAGE_OPEN_FAILED",
                Some(path.display().to_string()),
                error.to_string(),
            );
            report.stage("CONTAINER_SAFETY", false, "Package could not be opened.");
            return (report.finish(), None);
        }
    };
    let metadata = match file.metadata() {
        Ok(metadata) => metadata,
        Err(error) => {
            report.operational_error = true;
            report.error(
                "PACKAGE_OPEN_FAILED",
                Some(path.display().to_string()),
                error.to_string(),
            );
            report.stage("CONTAINER_SAFETY", false, "Package could not be opened.");
            return (report.finish(), None);
        }
    };
    if !metadata.is_file() {
        report.error(
            "PACKAGE_NOT_REGULAR_FILE",
            Some(path.display().to_string()),
            "Package input must be a regular file.",
        );
        report.stage(
            "CONTAINER_SAFETY",
            false,
            "Package input is not a regular file.",
        );
        return (report.finish(), None);
    }
    if metadata.len() > limits.max_package_bytes {
        report.error(
            "PACKAGE_SIZE_LIMIT_EXCEEDED",
            Some(path.display().to_string()),
            "Package exceeds the configured byte limit.",
        );
        report.stage("CONTAINER_SAFETY", false, "Container safety limits failed.");
        return (report.finish(), None);
    }
    let declared_entries = match declared_zip_entry_count(&mut file) {
        Ok(count) => count,
        Err(error) if error.kind == ErrorKind::Io => {
            report.operational_error = true;
            report.error(error.code, Some(path.display().to_string()), error.message);
            report.stage("CONTAINER_SAFETY", false, "Package could not be read.");
            return (report.finish(), None);
        }
        Err(error) => {
            report.error(
                "MALFORMED_ZIP",
                Some(path.display().to_string()),
                error.message,
            );
            report.stage("CONTAINER_SAFETY", false, "ZIP container is malformed.");
            return (report.finish(), None);
        }
    };
    if declared_entries > limits.max_entries {
        report.error(
            "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
            None,
            format!(
                "ZIP declares {declared_entries} entries; the maximum is {}.",
                limits.max_entries
            ),
        );
        report.stage("CONTAINER_SAFETY", false, "Container safety limits failed.");
        return (report.finish(), None);
    }
    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(error) => {
            report.error(
                "MALFORMED_ZIP",
                Some(path.display().to_string()),
                error.to_string(),
            );
            report.stage("CONTAINER_SAFETY", false, "ZIP container is malformed.");
            return (report.finish(), None);
        }
    };
    let container_error_start = report.errors.len();
    let entries = inspect_entries(&mut archive, declared_entries, limits, &mut report);
    let container_safe = report.errors.len() == container_error_start;
    report.stage(
        "CONTAINER_SAFETY",
        container_safe,
        if container_safe {
            "ZIP container passed path, type, count, size, and compression checks."
        } else {
            "ZIP container failed one or more safety checks."
        },
    );
    if !container_safe {
        return (report.finish(), None);
    }

    let manifest_error_start = report.errors.len();
    let manifest = read_and_validate_manifest(&mut archive, &entries, limits, &mut report);
    let manifest_valid = report.errors.len() == manifest_error_start && manifest.is_some();
    report.stage(
        "MANIFEST",
        manifest_valid,
        if manifest_valid {
            "Manifest syntax, Schema, semantics, canonical form, and entry coverage are valid."
        } else {
            "Manifest failed one or more validation checks."
        },
    );
    let Some((manifest, manifest_bytes)) = manifest else {
        return (report.finish(), None);
    };
    if matches!(
        manifest.spec_version.as_str(),
        LEGACY_SCHEMA_VERSION
            | SIGNED_SCHEMA_VERSION
            | TRUSTED_SCHEMA_VERSION
            | C2PA_SCHEMA_VERSION
            | SCHEMA_VERSION
    ) {
        report.spec_version = manifest.spec_version.clone();
    }
    report.signature = if manifest.spec_version == LEGACY_SCHEMA_VERSION {
        SignatureAssurance::NotPresent
    } else {
        SignatureAssurance::Absent
    };
    report.trusted_time = if matches!(
        report.spec_version.as_str(),
        TRUSTED_SCHEMA_VERSION | C2PA_SCHEMA_VERSION | SCHEMA_VERSION
    ) {
        TimeAssurance::Absent
    } else {
        TimeAssurance::NotPresent
    };
    if validate_proof_id(&manifest.proof_id).is_ok() {
        report.proof_id = Some(manifest.proof_id.clone());
    }

    let asset_error_start = report.errors.len();
    verify_assets(&mut archive, &entries, limits, &manifest, &mut report);
    let assets_valid = report.errors.len() == asset_error_start;
    report.stage(
        "ASSETS",
        assets_valid,
        if assets_valid {
            "All declared asset sizes and SHA-256 digests match."
        } else {
            "One or more declared assets failed integrity checks."
        },
    );

    let event_error_start = report.errors.len();
    let events = verify_events(&mut archive, &entries, limits, &manifest, &mut report);
    let events_valid = report.errors.len() == event_error_start;
    report.stage(
        "EVENT_CHAIN",
        events_valid,
        if events_valid {
            "Event sequence, links, hashes, count, and root hash match."
        } else {
            "Event chain failed one or more integrity checks."
        },
    );
    report.internal_integrity = Some(if report.errors.is_empty() {
        InternalIntegrity::Valid
    } else {
        InternalIntegrity::Invalid
    });

    if matches!(
        manifest.spec_version.as_str(),
        SIGNED_SCHEMA_VERSION | TRUSTED_SCHEMA_VERSION | C2PA_SCHEMA_VERSION | SCHEMA_VERSION
    ) {
        let signature_error_start = report.errors.len();
        verify_creator_signature(
            &mut archive,
            &entries,
            limits,
            &manifest,
            &manifest_bytes,
            trust,
            &mut report,
        );
        let signature_valid = report.errors.len() == signature_error_start
            && matches!(
                report.signature,
                SignatureAssurance::ValidUntrusted
                    | SignatureAssurance::ValidLocallyTrusted
                    | SignatureAssurance::Disabled
            );
        report.stage(
            "CREATOR_SIGNATURE",
            signature_valid,
            if signature_valid {
                "Creator Ed25519 signature is cryptographically valid for the canonical Manifest."
            } else {
                "Creator signature is absent, unsupported, malformed, or invalid."
            },
        );
    }
    if matches!(
        manifest.spec_version.as_str(),
        TRUSTED_SCHEMA_VERSION | C2PA_SCHEMA_VERSION | SCHEMA_VERSION
    ) {
        verify_trusted_timestamp(
            &mut archive,
            &entries,
            limits,
            &manifest,
            tsa_profile,
            &mut report,
        );
    }
    if matches!(
        manifest.spec_version.as_str(),
        C2PA_SCHEMA_VERSION | SCHEMA_VERSION
    ) {
        let c2pa_error_start = report.errors.len();
        report.c2pa_evidence = Some(match events.as_deref() {
            Some(events) => collect_c2pa_evidence(events, &manifest, &mut report),
            None => C2paEvidence {
                state: C2paAssurance::Absent,
                observations: Vec::new(),
            },
        });
        let observations_valid = report.errors.len() == c2pa_error_start;
        report.stage(
            "C2PA_OBSERVATIONS",
            observations_valid,
            if observations_valid {
                "Digest-bound C2PA observations are structurally valid and remain a separate assurance signal."
            } else {
                "One or more C2PA observation events are malformed or do not match a declared asset."
            },
        );
    }
    let report = report.finish();
    let verified_manifest = (report.status == VerificationStatus::Valid).then_some(manifest);
    (report, verified_manifest)
}

pub fn inspect_package(path: &Path, limits: &VerificationLimits) -> CoreResult<Inspection> {
    let mut file =
        File::open(path).map_err(|error| CoreError::io("PACKAGE_OPEN_FAILED", path, error))?;
    let metadata = file
        .metadata()
        .map_err(|error| CoreError::io("PACKAGE_METADATA_FAILED", path, error))?;
    if !metadata.is_file() {
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "PACKAGE_NOT_REGULAR_FILE",
            "Package input must be a regular file.",
        )
        .at_path(path));
    }
    if metadata.len() > limits.max_package_bytes {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "PACKAGE_SIZE_LIMIT_EXCEEDED",
            "Package exceeds the configured byte limit.",
        )
        .at_path(path));
    }
    let declared_entries = declared_zip_entry_count(&mut file)?;
    if declared_entries > limits.max_entries {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
            "ZIP entry count exceeds the configured limit.",
        )
        .at_path(path));
    }
    let mut archive = ZipArchive::new(file).map_err(|error| {
        CoreError::new(ErrorKind::PackageFormat, "MALFORMED_ZIP", error.to_string())
    })?;
    let mut report = ReportBuilder::new("1970-01-01T00:00:00Z".to_owned());
    let entries = inspect_entries(&mut archive, declared_entries, limits, &mut report);
    if let Some(error) = report.errors.first() {
        return Err(CoreError::new(
            ErrorKind::UnsafeZipEntry,
            "PACKAGE_INSPECTION_REJECTED",
            format!("{}: {}", error.code, error.message),
        ));
    }
    let manifest = read_and_validate_manifest(&mut archive, &entries, limits, &mut report);
    if let Some(error) = report.errors.first() {
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "PACKAGE_INSPECTION_REJECTED",
            format!("{}: {}", error.code, error.message),
        ));
    }
    let (manifest, _) = manifest.ok_or_else(|| {
        CoreError::new(
            ErrorKind::PackageFormat,
            "MANIFEST_MISSING",
            "manifest.json is missing.",
        )
    })?;
    let creator_signature = manifest
        .security
        .as_ref()
        .map(|security| security.creator_signature.clone());
    let trusted_timestamp = manifest
        .security
        .as_ref()
        .and_then(|security| security.trusted_timestamp.clone());
    Ok(Inspection {
        spec_version: manifest.spec_version,
        proof_id: manifest.proof_id,
        created_at: manifest.created_at,
        project: manifest.project,
        assets: manifest.assets,
        event_chain: manifest.event_chain,
        assurance_level: if trusted_timestamp.is_some() {
            "Creator signature and RFC 3161 timestamp plan metadata present (not verified by inspect)"
                .to_owned()
        } else if creator_signature.is_some() {
            "Creator signature metadata present (not verified by inspect)".to_owned()
        } else {
            "Internal Integrity (not evaluated by inspect)".to_owned()
        },
        verification_performed: false,
        creator_signature,
        trusted_timestamp,
    })
}

fn inspect_entries<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    declared_entries: usize,
    limits: &VerificationLimits,
    report: &mut ReportBuilder,
) -> Vec<EntryMetadata> {
    if archive.is_empty() {
        report.error("ZIP_EMPTY", None, "ZIP container has no entries.");
    }
    if declared_entries > limits.max_entries {
        report.error(
            "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
            None,
            format!(
                "ZIP contains {} entries; the maximum is {}.",
                declared_entries, limits.max_entries
            ),
        );
        return Vec::new();
    }
    if archive.len() != declared_entries {
        report.error(
            "ZIP_ENTRY_DUPLICATE",
            None,
            "ZIP central directory contains duplicate decoded entry names.",
        );
    }
    let mut entries = Vec::new();
    let mut exact_names = HashSet::new();
    let mut folded_names = HashMap::<String, String>::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(error) => {
                report.error(
                    "ZIP_ENTRY_METADATA_UNREADABLE",
                    None,
                    format!("Entry {index}: {error}"),
                );
                continue;
            }
        };
        let name = match std::str::from_utf8(entry.name_raw()) {
            Ok(name) => name.to_owned(),
            Err(_) => {
                report.error(
                    "ZIP_ENTRY_NAME_NOT_UTF8",
                    None,
                    format!("Entry {index} name is not UTF-8."),
                );
                continue;
            }
        };
        if let Err(message) = validate_package_path(&name) {
            report.error("ZIP_ENTRY_PATH_UNSAFE", Some(name.clone()), message);
        }
        if entry.enclosed_name().is_none() {
            report.error(
                "ZIP_ENTRY_PATH_UNSAFE",
                Some(name.clone()),
                "ZIP entry is not an enclosed relative path.",
            );
        }
        if !exact_names.insert(name.clone()) {
            report.error(
                if name == MANIFEST_PATH {
                    "MANIFEST_DUPLICATE"
                } else {
                    "ZIP_ENTRY_DUPLICATE"
                },
                Some(name.clone()),
                "ZIP entry name is duplicated.",
            );
        }
        let folded = name.to_lowercase();
        if let Some(existing) = folded_names.insert(folded, name.clone()) {
            if existing != name {
                report.error(
                    "ZIP_ENTRY_CASE_CONFLICT",
                    Some(name.clone()),
                    format!("ZIP entry conflicts by case with {existing}."),
                );
            }
        }
        if entry.encrypted() {
            report.error(
                "ZIP_ENTRY_ENCRYPTED",
                Some(name.clone()),
                "Encrypted ZIP entries are not supported.",
            );
        }
        if entry.is_symlink() {
            report.error(
                "ZIP_ENTRY_SYMBOLIC_LINK",
                Some(name.clone()),
                "Symbolic link ZIP entries are forbidden.",
            );
        } else if entry.is_dir() || !entry.is_file() || has_non_regular_unix_type(entry.unix_mode())
        {
            report.error(
                "ZIP_ENTRY_NOT_REGULAR_FILE",
                Some(name.clone()),
                "Only regular-file ZIP entries are permitted.",
            );
        }
        if !matches!(
            entry.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            report.error(
                "ZIP_COMPRESSION_UNSUPPORTED",
                Some(name.clone()),
                "Only Stored and Deflated ZIP entries are supported.",
            );
        }
        if entry.size() > limits.max_single_entry_bytes {
            report.error(
                "ZIP_SINGLE_ENTRY_LIMIT_EXCEEDED",
                Some(name.clone()),
                "ZIP entry exceeds the single-entry uncompressed limit.",
            );
        }
        match total_size.checked_add(entry.size()) {
            Some(total) => total_size = total,
            None => report.error(
                "ZIP_TOTAL_SIZE_OVERFLOW",
                Some(name.clone()),
                "ZIP uncompressed size total overflowed u64.",
            ),
        }
        let ratio_limit = entry
            .compressed_size()
            .checked_mul(limits.max_compression_ratio)
            .unwrap_or(u64::MAX);
        if entry.size() > 0 && (entry.compressed_size() == 0 || entry.size() > ratio_limit) {
            report.error(
                "ZIP_COMPRESSION_RATIO_LIMIT_EXCEEDED",
                Some(name.clone()),
                "ZIP entry exceeds the configured compression ratio.",
            );
        }
        entries.push(EntryMetadata {
            index,
            name,
            size: entry.size(),
        });
    }
    if total_size > limits.max_total_uncompressed_bytes {
        report.error(
            "ZIP_TOTAL_SIZE_LIMIT_EXCEEDED",
            None,
            "ZIP total uncompressed size exceeds the configured limit.",
        );
    }
    entries
}

fn read_and_validate_manifest<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[EntryMetadata],
    limits: &VerificationLimits,
    report: &mut ReportBuilder,
) -> Option<(Manifest, Vec<u8>)> {
    let Some(metadata) = entries.iter().find(|entry| entry.name == MANIFEST_PATH) else {
        report.error(
            "MANIFEST_MISSING",
            Some(MANIFEST_PATH.to_owned()),
            "manifest.json is required.",
        );
        return None;
    };
    let bytes = match read_entry_limited(
        archive,
        metadata,
        limits.max_manifest_bytes,
        "MANIFEST_LIMIT_EXCEEDED",
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            report.error(error.code, Some(MANIFEST_PATH.to_owned()), error.message);
            return None;
        }
    };
    let value: Value = match parse_json_strict(&bytes) {
        Ok(value) => value,
        Err(error) => {
            report.error(
                "MANIFEST_JSON_MALFORMED",
                Some(MANIFEST_PATH.to_owned()),
                error.to_string(),
            );
            return None;
        }
    };
    match canonical_json(&value) {
        Ok(canonical) if canonical != bytes => report.error(
            "MANIFEST_NOT_CANONICAL",
            Some(MANIFEST_PATH.to_owned()),
            "manifest.json is not RFC 8785 JCS canonical JSON.",
        ),
        Err(error) => report.error(error.code, Some(MANIFEST_PATH.to_owned()), error.message),
        Ok(_) => {}
    }
    if let Err(errors) = validate_manifest_schema(&value) {
        for message in errors {
            report.error(
                "MANIFEST_SCHEMA_INVALID",
                Some(MANIFEST_PATH.to_owned()),
                message,
            );
        }
    }
    let manifest: Manifest = match serde_json::from_value(value) {
        Ok(manifest) => manifest,
        Err(error) => {
            report.error(
                "MANIFEST_MODEL_INVALID",
                Some(MANIFEST_PATH.to_owned()),
                error.to_string(),
            );
            return None;
        }
    };
    for issue in manifest.validate() {
        report.error(issue.code, Some(issue.field), issue.message);
    }
    check_entry_coverage(entries, &manifest, report);
    Some((manifest, bytes))
}

fn check_entry_coverage(
    entries: &[EntryMetadata],
    manifest: &Manifest,
    report: &mut ReportBuilder,
) {
    let mut expected = vec![MANIFEST_PATH.to_owned()];
    expected.extend(
        manifest
            .assets
            .iter()
            .map(|asset| asset.package_path.clone()),
    );
    expected.push(EVENTS_PATH.to_owned());
    if let Some(security) = &manifest.security {
        expected.push(security.creator_signature.public_key_path.clone());
        expected.push(security.creator_signature.signature_path.clone());
        if let Some(timestamp) = &security.trusted_timestamp {
            if entries
                .iter()
                .any(|entry| entry.name == timestamp.timestamp_path)
            {
                expected.push(timestamp.timestamp_path.clone());
            }
        }
    }
    let actual: Vec<String> = entries.iter().map(|entry| entry.name.clone()).collect();
    if actual != expected {
        report.error(
            "ZIP_ENTRY_ORDER_INVALID",
            None,
            "ZIP entry order must be manifest.json, sorted assets, events.json, creator key/signature, then the optional predeclared timestamp response.",
        );
    }
    let expected_set: HashSet<&str> = expected.iter().map(String::as_str).collect();
    let actual_set: HashSet<&str> = actual.iter().map(String::as_str).collect();
    let mut missing: Vec<&str> = expected_set.difference(&actual_set).copied().collect();
    missing.sort_unstable();
    for path in missing {
        report.error(
            if path == EVENTS_PATH {
                "EVENTS_MISSING"
            } else if path.starts_with("security/") {
                "SECURITY_ENTRY_MISSING"
            } else {
                "ASSET_MISSING"
            },
            Some(path.to_owned()),
            "Manifest-declared package entry is missing.",
        );
    }
    let mut unexpected: Vec<&str> = actual_set.difference(&expected_set).copied().collect();
    unexpected.sort_unstable();
    for path in unexpected {
        report.error(
            "ZIP_ENTRY_UNDECLARED",
            Some(path.to_owned()),
            "ZIP entry is not declared by the manifest.",
        );
    }
}

fn verify_trusted_timestamp<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[EntryMetadata],
    limits: &VerificationLimits,
    manifest: &Manifest,
    profile: Option<&ParsedTsaProfile>,
    report: &mut ReportBuilder,
) {
    let Some(security) = &manifest.security else {
        report.stage(
            "TRUSTED_TIME",
            false,
            "Protocol 0.4 timestamp plan is missing.",
        );
        return;
    };
    let Some(descriptor) = &security.trusted_timestamp else {
        report.stage(
            "TRUSTED_TIME",
            false,
            "Protocol 0.4 timestamp plan is missing.",
        );
        return;
    };
    let base_evidence = || TrustedTimeEvidence {
        profile: TRUSTED_TIMESTAMP_PROFILE.to_owned(),
        timestamp_path: descriptor.timestamp_path.clone(),
        tsa_profile_sha256: descriptor.tsa_profile_sha256.clone(),
        requested_policy: descriptor.requested_policy.clone(),
        granted_policy: None,
        gen_time: None,
        source_label: profile.map(|value| value.profile.source_label.clone()),
        revocation: RevocationEvidenceState::NotProvided,
    };
    let Some(timestamp_metadata) = entries
        .iter()
        .find(|entry| entry.name == descriptor.timestamp_path)
    else {
        report.trusted_time = TimeAssurance::Absent;
        report.trusted_time_evidence = Some(base_evidence());
        report.timestamp_warning = Some((
            "TRUSTED_TIMESTAMP_ABSENT".to_owned(),
            "Creator signature is valid, but no RFC 3161 response is attached.".to_owned(),
        ));
        report.stage(
            "TRUSTED_TIME",
            false,
            "No RFC 3161 response is attached; creator-signature validity is unchanged.",
        );
        return;
    };
    let response = match read_entry_limited(
        archive,
        timestamp_metadata,
        limits.max_timestamp_response_bytes,
        "TRUSTED_TIMESTAMP_LIMIT_EXCEEDED",
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            report.trusted_time = TimeAssurance::Malformed;
            report.trusted_time_evidence = Some(base_evidence());
            report.timestamp_warning = Some((error.code.to_owned(), error.message));
            report.stage(
                "TRUSTED_TIME",
                false,
                "Attached RFC 3161 response is malformed or exceeds its bound.",
            );
            return;
        }
    };
    let Some(signature_metadata) = entries
        .iter()
        .find(|entry| entry.name == security.creator_signature.signature_path)
    else {
        report.trusted_time = TimeAssurance::Malformed;
        report.trusted_time_evidence = Some(base_evidence());
        report.stage(
            "TRUSTED_TIME",
            false,
            "Creator signature bytes required for timestamp verification are missing.",
        );
        return;
    };
    let signature = match read_entry_limited(
        archive,
        signature_metadata,
        limits.max_signature_bytes,
        "CREATOR_SIGNATURE_LIMIT_EXCEEDED",
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            report.trusted_time = TimeAssurance::Malformed;
            report.trusted_time_evidence = Some(base_evidence());
            report.timestamp_warning = Some((error.code.to_owned(), error.message));
            report.stage(
                "TRUSTED_TIME",
                false,
                "Creator signature bytes required for timestamp verification are invalid.",
            );
            return;
        }
    };
    let Some(profile) = profile else {
        report.trusted_time = TimeAssurance::Untrusted;
        report.trusted_time_evidence = Some(base_evidence());
        report.timestamp_warning = Some((
            "TSA_PROFILE_NOT_IMPORTED".to_owned(),
            "Timestamp response is attached but no matching explicit TSA trust snapshot was supplied for offline verification.".to_owned(),
        ));
        report.stage(
            "TRUSTED_TIME",
            false,
            "Timestamp response was not trusted because no matching profile was supplied.",
        );
        return;
    };
    let verified = verify_timestamp_strict(
        &response,
        &signature,
        descriptor,
        profile,
        &report.verified_at,
    );
    let passed = verified.state == TimeAssurance::ValidTrusted;
    report.trusted_time = verified.state;
    report.trusted_time_evidence = Some(verified.evidence);
    if !passed {
        report.timestamp_warning = Some((verified.code.to_owned(), verified.message.clone()));
    }
    report.stage("TRUSTED_TIME", passed, &verified.message);
}

fn verify_creator_signature<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[EntryMetadata],
    limits: &VerificationLimits,
    manifest: &Manifest,
    manifest_bytes: &[u8],
    trust: &dyn Fn(&str) -> LocalTrust,
    report: &mut ReportBuilder,
) {
    let Some(security) = &manifest.security else {
        report.signature = SignatureAssurance::Absent;
        report.error(
            "CREATOR_SIGNATURE_ABSENT",
            Some("security".to_owned()),
            "Protocol 0.3 package has no creator signature descriptor.",
        );
        return;
    };
    let descriptor = &security.creator_signature;
    let Some(key_metadata) = entries
        .iter()
        .find(|entry| entry.name == descriptor.public_key_path)
    else {
        report.signature = SignatureAssurance::Absent;
        report.error(
            "CREATOR_KEY_MISSING",
            Some(descriptor.public_key_path.clone()),
            "Manifest-declared creator public key entry is missing.",
        );
        return;
    };
    let Some(signature_metadata) = entries
        .iter()
        .find(|entry| entry.name == descriptor.signature_path)
    else {
        report.signature = SignatureAssurance::Absent;
        report.error(
            "CREATOR_SIGNATURE_MISSING",
            Some(descriptor.signature_path.clone()),
            "Manifest-declared creator signature entry is missing.",
        );
        return;
    };
    let public_key = match read_entry_limited(
        archive,
        key_metadata,
        limits.max_public_key_bytes,
        "CREATOR_KEY_LIMIT_EXCEEDED",
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            report.signature = SignatureAssurance::Malformed;
            report.error(
                error.code,
                Some(descriptor.public_key_path.clone()),
                error.message,
            );
            return;
        }
    };
    let signature = match read_entry_limited(
        archive,
        signature_metadata,
        limits.max_signature_bytes,
        "CREATOR_SIGNATURE_LIMIT_EXCEEDED",
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            report.signature = SignatureAssurance::Malformed;
            report.error(
                error.code,
                Some(descriptor.signature_path.clone()),
                error.message,
            );
            return;
        }
    };
    let local_trust = trust(&descriptor.key_fingerprint);
    match verify_manifest_signature(
        manifest_bytes,
        descriptor,
        &public_key,
        &signature,
        local_trust,
    ) {
        Ok(verified) => {
            report.signature = verified.state;
            report.identity = IdentityAssurance::SelfAsserted;
            report.creator_signature = Some(verified.evidence);
        }
        Err(SignatureFailure {
            state,
            code,
            message,
        }) => {
            report.signature = state;
            report.error(code, Some(descriptor.signature_path.clone()), message);
        }
    }
}

fn verify_assets<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[EntryMetadata],
    limits: &VerificationLimits,
    manifest: &Manifest,
    report: &mut ReportBuilder,
) {
    for asset in &manifest.assets {
        if asset.size_bytes > limits.max_single_entry_bytes {
            report.error(
                "ASSET_SIZE_LIMIT_EXCEEDED",
                Some(asset.package_path.clone()),
                "Manifest asset size exceeds the single-entry limit.",
            );
            continue;
        }
        let Some(metadata) = entries
            .iter()
            .find(|entry| entry.name == asset.package_path)
        else {
            continue;
        };
        if metadata.size != asset.size_bytes {
            report.error(
                "ASSET_SIZE_MISMATCH",
                Some(asset.package_path.clone()),
                "Asset uncompressed size does not match the manifest.",
            );
        }
        let mut entry = match archive.by_index(metadata.index) {
            Ok(entry) => entry,
            Err(error) => {
                report.error(
                    "ASSET_READ_FAILED",
                    Some(asset.package_path.clone()),
                    error.to_string(),
                );
                continue;
            }
        };
        let read_limit = asset
            .size_bytes
            .min(limits.max_single_entry_bytes)
            .saturating_add(1);
        let mut limited = entry.by_ref().take(read_limit);
        match sha256_reader(&mut limited) {
            Ok(digest) => {
                if digest.size != asset.size_bytes {
                    report.error(
                        "ASSET_SIZE_MISMATCH",
                        Some(asset.package_path.clone()),
                        "Asset actual size does not match the manifest.",
                    );
                }
                if digest.sha256 != asset.sha256 {
                    report.error(
                        "ASSET_HASH_MISMATCH",
                        Some(asset.package_path.clone()),
                        "Asset SHA-256 does not match the manifest.",
                    );
                }
            }
            Err(error) => report.error(
                "ASSET_READ_FAILED",
                Some(asset.package_path.clone()),
                error.message,
            ),
        }
    }
}

fn verify_events<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[EntryMetadata],
    limits: &VerificationLimits,
    manifest: &Manifest,
    report: &mut ReportBuilder,
) -> Option<Vec<Event>> {
    let metadata = entries.iter().find(|entry| entry.name == EVENTS_PATH)?;
    let bytes = match read_entry_limited(
        archive,
        metadata,
        limits.max_event_bytes,
        "EVENT_JSON_LIMIT_EXCEEDED",
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            report.error(error.code, Some(EVENTS_PATH.to_owned()), error.message);
            return None;
        }
    };
    let value: Value = match parse_json_strict(&bytes) {
        Ok(value) => value,
        Err(error) => {
            report.error(
                "EVENT_JSON_MALFORMED",
                Some(EVENTS_PATH.to_owned()),
                error.to_string(),
            );
            return None;
        }
    };
    match canonical_json(&value) {
        Ok(canonical) if canonical != bytes => report.error(
            "EVENT_JSON_NOT_CANONICAL",
            Some(EVENTS_PATH.to_owned()),
            "events.json is not RFC 8785 JCS canonical JSON.",
        ),
        Err(error) => report.error(error.code, Some(EVENTS_PATH.to_owned()), error.message),
        Ok(_) => {}
    }
    let Some(values) = value.as_array() else {
        report.error(
            "EVENT_JSON_NOT_ARRAY",
            Some(EVENTS_PATH.to_owned()),
            "events.json must contain an array.",
        );
        return None;
    };
    for (index, event_value) in values.iter().enumerate() {
        if let Err(errors) = validate_event_schema(event_value) {
            for message in errors {
                report.error(
                    "EVENT_SCHEMA_INVALID",
                    Some(format!("events[{index}]")),
                    message,
                );
            }
        }
    }
    let events: Vec<Event> = match serde_json::from_value(value) {
        Ok(events) => events,
        Err(error) => {
            report.error(
                "EVENT_MODEL_INVALID",
                Some(EVENTS_PATH.to_owned()),
                error.to_string(),
            );
            return None;
        }
    };
    for issue in verify_event_chain(&events) {
        report.error(
            issue.code,
            Some(format!("events[{}]", issue.index)),
            issue.message,
        );
    }
    if events.len() as u64 != manifest.event_chain.event_count {
        report.error(
            "EVENT_COUNT_MISMATCH",
            Some("event_chain.event_count".to_owned()),
            "Manifest event_count does not match events.json.",
        );
    }
    let root = events.last().map(|event| event.event_hash.as_str());
    if root != manifest.event_chain.root_hash.as_deref() {
        report.error(
            "EVENT_ROOT_HASH_MISMATCH",
            Some("event_chain.root_hash".to_owned()),
            "Manifest root_hash does not match the final event_hash.",
        );
    }
    Some(events)
}

fn collect_c2pa_evidence(
    events: &[Event],
    manifest: &Manifest,
    report: &mut ReportBuilder,
) -> C2paEvidence {
    let mut observations = Vec::new();
    let mut observed_assets = HashSet::new();
    for (index, event) in events.iter().enumerate() {
        if event.event_type != C2PA_OBSERVATION_EVENT {
            continue;
        }
        let observation: C2paObservation = match serde_json::from_value(event.payload.clone()) {
            Ok(observation) => observation,
            Err(_) => {
                report.error(
                    "C2PA_OBSERVATION_MODEL_INVALID",
                    Some(format!("events[{index}].payload")),
                    "C2PA observation payload does not match the bounded bridge model.",
                );
                continue;
            }
        };
        for issue in observation.validate() {
            report.error(
                issue.code,
                Some(format!("events[{index}].payload.{}", issue.field)),
                issue.message,
            );
        }
        let Some(asset) = manifest
            .assets
            .iter()
            .find(|asset| asset.asset_id == observation.asset_id)
        else {
            report.error(
                "C2PA_OBSERVATION_ASSET_MISSING",
                Some(format!("events[{index}].payload.asset_id")),
                "C2PA observation does not reference a declared package asset.",
            );
            continue;
        };
        if asset.sha256 != observation.asset_sha256 {
            report.error(
                "C2PA_OBSERVATION_ASSET_DIGEST_MISMATCH",
                Some(format!("events[{index}].payload.asset_sha256")),
                "C2PA observation asset digest does not match the declared package asset.",
            );
        }
        if !observed_assets.insert(observation.asset_id.clone()) {
            report.error(
                "C2PA_OBSERVATION_DUPLICATE_ASSET",
                Some(format!("events[{index}].payload.asset_id")),
                "Only one unambiguous C2PA observation may be recorded for each asset.",
            );
        }
        observations.push(observation);
    }
    let state = if observations.is_empty() {
        C2paAssurance::Absent
    } else if observations
        .iter()
        .any(|observation| matches!(observation.validation_state, C2paValidationState::Invalid))
    {
        C2paAssurance::ObservedInvalid
    } else if observations
        .iter()
        .all(|observation| matches!(observation.validation_state, C2paValidationState::Trusted))
    {
        C2paAssurance::ObservedTrusted
    } else {
        C2paAssurance::ObservedValidUntrusted
    };
    C2paEvidence {
        state,
        observations,
    }
}

fn read_entry_limited<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    metadata: &EntryMetadata,
    limit: u64,
    limit_code: &'static str,
) -> CoreResult<Vec<u8>> {
    if metadata.size > limit {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            limit_code,
            "Structured ZIP entry exceeds its configured limit.",
        ));
    }
    let entry = archive.by_index(metadata.index).map_err(|error| {
        CoreError::new(
            ErrorKind::PackageFormat,
            "ZIP_ENTRY_READ_FAILED",
            error.to_string(),
        )
    })?;
    let mut bytes = Vec::with_capacity(metadata.size as usize);
    entry
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CoreError::new(
                ErrorKind::PackageFormat,
                "ZIP_ENTRY_READ_FAILED",
                error.to_string(),
            )
        })?;
    if bytes.len() as u64 > limit {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            limit_code,
            "Structured ZIP entry exceeds its configured limit.",
        ));
    }
    if bytes.len() as u64 != metadata.size {
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "ZIP_ENTRY_SIZE_METADATA_MISMATCH",
            "ZIP entry actual size differs from central-directory metadata.",
        ));
    }
    Ok(bytes)
}

struct ReportBuilder {
    spec_version: String,
    verified_at: String,
    proof_id: Option<String>,
    internal_integrity: Option<InternalIntegrity>,
    identity: IdentityAssurance,
    signature: SignatureAssurance,
    creator_signature: Option<CreatorSignatureEvidence>,
    trusted_time: TimeAssurance,
    trusted_time_evidence: Option<TrustedTimeEvidence>,
    c2pa_evidence: Option<C2paEvidence>,
    timestamp_warning: Option<(String, String)>,
    checks: Vec<CheckResult>,
    errors: Vec<VerificationError>,
    operational_error: bool,
}

impl ReportBuilder {
    fn new(verified_at: String) -> Self {
        let verified_at = if proof_schema::validate_canonical_timestamp(&verified_at).is_ok() {
            verified_at
        } else {
            "1970-01-01T00:00:00Z".to_owned()
        };
        Self {
            spec_version: SCHEMA_VERSION.to_owned(),
            verified_at,
            proof_id: None,
            internal_integrity: None,
            identity: IdentityAssurance::NotVerified,
            signature: SignatureAssurance::Absent,
            creator_signature: None,
            trusted_time: TimeAssurance::Absent,
            trusted_time_evidence: None,
            c2pa_evidence: None,
            timestamp_warning: None,
            checks: Vec::new(),
            errors: Vec::new(),
            operational_error: false,
        }
    }

    fn error(&mut self, code: impl Into<String>, path: Option<String>, message: impl Into<String>) {
        self.errors.push(VerificationError {
            code: code.into(),
            path,
            message: message.into(),
        });
    }

    fn stage(&mut self, code: &str, passed: bool, message: &str) {
        self.checks.push(CheckResult {
            code: code.to_owned(),
            status: if passed {
                CheckStatus::Pass
            } else {
                CheckStatus::Fail
            },
            path: None,
            message: message.to_owned(),
        });
    }

    fn finish(self) -> VerificationReport {
        let status = if self.operational_error {
            VerificationStatus::Error
        } else if self.errors.is_empty() {
            VerificationStatus::Valid
        } else {
            VerificationStatus::Invalid
        };
        let integrity = if self.operational_error {
            InternalIntegrity::NotEvaluated
        } else {
            self.internal_integrity.unwrap_or({
                if self.errors.is_empty() {
                    InternalIntegrity::Valid
                } else {
                    InternalIntegrity::Invalid
                }
            })
        };
        let mut assurance = Assurance::for_integrity(integrity);
        assurance.creator_identity = self.identity;
        assurance.official_identity = (self.spec_version == SCHEMA_VERSION)
            .then_some(proof_schema::OfficialIdentityAssurance::Absent);
        assurance.digital_signature = self.signature.clone();
        assurance.trusted_time = self.trusted_time.clone();
        let mut warnings = Vec::new();
        if self.spec_version == LEGACY_SCHEMA_VERSION {
            warnings.push(VerificationWarning {
                code: "INTERNAL_INTEGRITY_ONLY".to_owned(),
                message: "Protocol 0.2 evaluates package internal integrity only; creator identity, digital signature, trusted time and originality are not asserted.".to_owned(),
            });
        } else {
            warnings.push(VerificationWarning {
                code: "ASSURANCE_LIMITS".to_owned(),
                message: if matches!(self.spec_version.as_str(), C2PA_SCHEMA_VERSION | SCHEMA_VERSION) {
                    "Creator display label remains self-asserted. Official identity is absent unless separately imported and verified. Trusted time witnesses only the exact creator signature. C2PA reports provenance metadata, not factual truth, identity, originality or rights.".to_owned()
                } else {
                    "Creator display label is self-asserted. Trusted time and originality are not evaluated.".to_owned()
                },
            });
            match self.signature {
                SignatureAssurance::ValidUntrusted => warnings.push(VerificationWarning {
                    code: "CREATOR_KEY_NOT_LOCALLY_TRUSTED".to_owned(),
                    message: "Signature is cryptographically valid, but this key is not the current local creator key.".to_owned(),
                }),
                SignatureAssurance::Disabled => warnings.push(VerificationWarning {
                    code: "CREATOR_KEY_LOCALLY_DISABLED".to_owned(),
                    message: "Signature is cryptographically valid, but the matching local creator key is disabled for new signing.".to_owned(),
                }),
                _ => {}
            }
            if self.creator_signature.as_ref().is_some_and(|evidence| {
                display_label_needs_confusable_warning(&evidence.display_label)
            }) {
                warnings.push(VerificationWarning {
                    code: "CREATOR_DISPLAY_LABEL_CONFUSABLE_REVIEW".to_owned(),
                    message: "The self-asserted display label contains non-ASCII characters; compare the full key fingerprint before trusting it.".to_owned(),
                });
            }
        }
        if let Some((code, message)) = self.timestamp_warning {
            warnings.push(VerificationWarning { code, message });
        }
        let c2pa = if matches!(
            self.spec_version.as_str(),
            C2PA_SCHEMA_VERSION | SCHEMA_VERSION
        ) {
            Some(self.c2pa_evidence.unwrap_or(C2paEvidence {
                state: C2paAssurance::Absent,
                observations: Vec::new(),
            }))
        } else {
            None
        };
        VerificationReport {
            spec_version: self.spec_version,
            proof_id: self.proof_id,
            verified_at: self.verified_at,
            status,
            assurance,
            creator_signature: self.creator_signature,
            trusted_time: self.trusted_time_evidence,
            c2pa,
            checks: self.checks,
            errors: self.errors,
            warnings,
        }
    }
}

fn has_non_regular_unix_type(mode: Option<u32>) -> bool {
    const FILE_TYPE_MASK: u32 = 0o170000;
    const REGULAR_FILE: u32 = 0o100000;
    mode.is_some_and(|mode| {
        let file_type = mode & FILE_TYPE_MASK;
        file_type != 0 && file_type != REGULAR_FILE
    })
}

fn declared_zip_entry_count(file: &mut File) -> CoreResult<usize> {
    const EOCD_SIGNATURE: &[u8; 4] = b"PK\x05\x06";
    const ZIP64_LOCATOR_SIGNATURE: &[u8; 4] = b"PK\x06\x07";
    const ZIP64_EOCD_SIGNATURE: &[u8; 4] = b"PK\x06\x06";
    const MAX_EOCD_SIZE: u64 = 22 + u16::MAX as u64;

    let file_size = file
        .metadata()
        .map_err(|error| {
            CoreError::new(ErrorKind::Io, "PACKAGE_METADATA_FAILED", error.to_string())
        })?
        .len();
    let tail_size = file_size.min(MAX_EOCD_SIZE);
    file.seek(SeekFrom::End(-(tail_size as i64)))
        .map_err(|error| CoreError::new(ErrorKind::Io, "PACKAGE_SEEK_FAILED", error.to_string()))?;
    let mut tail = vec![0_u8; tail_size as usize];
    file.read_exact(&mut tail)
        .map_err(|error| CoreError::new(ErrorKind::Io, "PACKAGE_READ_FAILED", error.to_string()))?;
    let eocd_offset = tail
        .windows(EOCD_SIGNATURE.len())
        .enumerate()
        .rev()
        .find_map(|(offset, signature)| {
            if signature != EOCD_SIGNATURE || offset + 22 > tail.len() {
                return None;
            }
            let comment_len = u16::from_le_bytes([tail[offset + 20], tail[offset + 21]]) as usize;
            (offset + 22 + comment_len == tail.len()).then_some(offset)
        })
        .ok_or_else(|| {
            CoreError::new(
                ErrorKind::PackageFormat,
                "ZIP_EOCD_MISSING",
                "ZIP end-of-central-directory record is missing or truncated.",
            )
        })?;
    let count = u16::from_le_bytes([tail[eocd_offset + 10], tail[eocd_offset + 11]]);
    if count != u16::MAX {
        return Ok(count as usize);
    }
    if eocd_offset < 20 || &tail[eocd_offset - 20..eocd_offset - 16] != ZIP64_LOCATOR_SIGNATURE {
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "ZIP64_LOCATOR_MISSING",
            "ZIP64 entry count sentinel requires a ZIP64 locator.",
        ));
    }
    let locator = eocd_offset - 20;
    let mut zip64_offset_bytes = [0_u8; 8];
    zip64_offset_bytes.copy_from_slice(&tail[locator + 8..locator + 16]);
    let zip64_offset = u64::from_le_bytes(zip64_offset_bytes);
    file.seek(SeekFrom::Start(zip64_offset))
        .map_err(|error| CoreError::new(ErrorKind::Io, "PACKAGE_SEEK_FAILED", error.to_string()))?;
    let mut zip64_header = [0_u8; 56];
    file.read_exact(&mut zip64_header).map_err(|error| {
        CoreError::new(
            ErrorKind::PackageFormat,
            "ZIP64_EOCD_INVALID",
            error.to_string(),
        )
    })?;
    if &zip64_header[..4] != ZIP64_EOCD_SIGNATURE {
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "ZIP64_EOCD_INVALID",
            "ZIP64 end-of-central-directory record is missing.",
        ));
    }
    let mut count_bytes = [0_u8; 8];
    count_bytes.copy_from_slice(&zip64_header[32..40]);
    let count = u64::from_le_bytes(count_bytes);
    usize::try_from(count).map_err(|_| {
        CoreError::new(
            ErrorKind::LimitExceeded,
            "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
            "ZIP entry count cannot fit this platform.",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_limits_are_centralized_and_nonzero() {
        let limits = VerificationLimits::default();
        assert_eq!(limits.max_entries, 1024);
        assert_eq!(limits.max_manifest_bytes, 1024 * 1024);
        assert_eq!(limits.max_event_bytes, 16 * 1024 * 1024);
        assert_eq!(limits.max_compression_ratio, 100);
        assert!(limits.max_total_uncompressed_bytes >= limits.max_single_entry_bytes);
    }
}
