use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek};
use std::path::Path;

use proof_schema::{
    Assurance, CheckResult, CheckStatus, EVENTS_PATH, Event, Inspection, InternalIntegrity,
    MANIFEST_PATH, Manifest, SCHEMA_VERSION, VerificationError, VerificationReport,
    VerificationStatus, VerificationWarning, parse_json_strict, validate_event_schema,
    validate_manifest_schema, validate_package_path,
};
use serde_json::Value;
use zip::{CompressionMethod, ZipArchive};

use crate::{
    CoreError, CoreResult, ErrorKind, canonical_json, sha256_reader, verify_event_chain,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationLimits {
    pub max_package_bytes: u64,
    pub max_entries: usize,
    pub max_manifest_bytes: u64,
    pub max_event_bytes: u64,
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
    let mut report = ReportBuilder::new(verified_at);
    if proof_schema::validate_canonical_timestamp(&report.verified_at).is_err() {
        report.operational_error = true;
        report.error(
            "INVALID_VERIFICATION_TIMESTAMP",
            None,
            "Verification timestamp is not canonical UTC RFC 3339.",
        );
        return report.finish();
    }
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            report.operational_error = true;
            report.error(
                "PACKAGE_OPEN_FAILED",
                Some(path.display().to_string()),
                error.to_string(),
            );
            report.stage(
                "CONTAINER_SAFETY",
                false,
                "Package could not be opened.",
            );
            return report.finish();
        }
    };
    if metadata.len() > limits.max_package_bytes {
        report.error(
            "PACKAGE_SIZE_LIMIT_EXCEEDED",
            Some(path.display().to_string()),
            "Package exceeds the configured byte limit.",
        );
        report.stage(
            "CONTAINER_SAFETY",
            false,
            "Container safety limits failed.",
        );
        return report.finish();
    }
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) => {
            report.operational_error = true;
            report.error(
                "PACKAGE_OPEN_FAILED",
                Some(path.display().to_string()),
                error.to_string(),
            );
            report.stage(
                "CONTAINER_SAFETY",
                false,
                "Package could not be opened.",
            );
            return report.finish();
        }
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(error) => {
            report.error(
                "MALFORMED_ZIP",
                Some(path.display().to_string()),
                error.to_string(),
            );
            report.stage(
                "CONTAINER_SAFETY",
                false,
                "ZIP container is malformed.",
            );
            return report.finish();
        }
    };
    let container_error_start = report.errors.len();
    let entries = inspect_entries(&mut archive, limits, &mut report);
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
        return report.finish();
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
    let Some(manifest) = manifest else {
        return report.finish();
    };
    report.proof_id = Some(manifest.proof_id.clone());

    let asset_error_start = report.errors.len();
    verify_assets(&mut archive, &entries, &manifest, &mut report);
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
    verify_events(&mut archive, &entries, limits, &manifest, &mut report);
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
    report.finish()
}

pub fn inspect_package(path: &Path, limits: &VerificationLimits) -> CoreResult<Inspection> {
    let file =
        File::open(path).map_err(|error| CoreError::io("PACKAGE_OPEN_FAILED", path, error))?;
    let mut archive = ZipArchive::new(file).map_err(|error| {
        CoreError::new(
            ErrorKind::PackageFormat,
            "MALFORMED_ZIP",
            error.to_string(),
        )
    })?;
    let mut report = ReportBuilder::new("1970-01-01T00:00:00Z".to_owned());
    let entries = inspect_entries(&mut archive, limits, &mut report);
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
    let manifest = manifest.ok_or_else(|| {
        CoreError::new(
            ErrorKind::PackageFormat,
            "MANIFEST_MISSING",
            "manifest.json is missing.",
        )
    })?;
    Ok(Inspection {
        spec_version: manifest.spec_version,
        proof_id: manifest.proof_id,
        created_at: manifest.created_at,
        project: manifest.project,
        assets: manifest.assets,
        event_chain: manifest.event_chain,
        assurance_level: "Internal Integrity (not evaluated by inspect)".to_owned(),
        verification_performed: false,
    })
}

fn inspect_entries<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    limits: &VerificationLimits,
    report: &mut ReportBuilder,
) -> Vec<EntryMetadata> {
    if archive.len() == 0 {
        report.error("ZIP_EMPTY", None, "ZIP container has no entries.");
    }
    if archive.len() > limits.max_entries {
        report.error(
            "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
            None,
            format!(
                "ZIP contains {} entries; the maximum is {}.",
                archive.len(),
                limits.max_entries
            ),
        );
        return Vec::new();
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
        } else if entry.is_dir() || !entry.is_file() {
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
        if entry.size() > 0
            && (entry.compressed_size() == 0 || entry.size() > ratio_limit)
        {
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
) -> Option<Manifest> {
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
        Err(error) => report.error(
            error.code,
            Some(MANIFEST_PATH.to_owned()),
            error.message,
        ),
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
        report.error(
            issue.code,
            Some(issue.field),
            issue.message,
        );
    }
    check_entry_coverage(entries, &manifest, report);
    Some(manifest)
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
    let actual: Vec<String> = entries.iter().map(|entry| entry.name.clone()).collect();
    if actual != expected {
        report.error(
            "ZIP_ENTRY_ORDER_INVALID",
            None,
            "ZIP entry order must be manifest.json, assets sorted by package_path, then events.json.",
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

fn verify_assets<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[EntryMetadata],
    manifest: &Manifest,
    report: &mut ReportBuilder,
) {
    for asset in &manifest.assets {
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
        let mut limited = entry.by_ref().take(asset.size_bytes.saturating_add(1));
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
) {
    let Some(metadata) = entries.iter().find(|entry| entry.name == EVENTS_PATH) else {
        return;
    };
    let bytes = match read_entry_limited(
        archive,
        metadata,
        limits.max_event_bytes,
        "EVENT_JSON_LIMIT_EXCEEDED",
    ) {
        Ok(bytes) => bytes,
        Err(error) => {
            report.error(error.code, Some(EVENTS_PATH.to_owned()), error.message);
            return;
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
            return;
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
        return;
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
            return;
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
    verified_at: String,
    proof_id: Option<String>,
    checks: Vec<CheckResult>,
    errors: Vec<VerificationError>,
    operational_error: bool,
}

impl ReportBuilder {
    fn new(verified_at: String) -> Self {
        Self {
            verified_at,
            proof_id: None,
            checks: Vec::new(),
            errors: Vec::new(),
            operational_error: false,
        }
    }

    fn error(
        &mut self,
        code: impl Into<String>,
        path: Option<String>,
        message: impl Into<String>,
    ) {
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
        let integrity = match status {
            VerificationStatus::Valid => InternalIntegrity::Valid,
            VerificationStatus::Invalid => InternalIntegrity::Invalid,
            VerificationStatus::Error => InternalIntegrity::NotEvaluated,
        };
        VerificationReport {
            spec_version: SCHEMA_VERSION.to_owned(),
            proof_id: self.proof_id,
            verified_at: self.verified_at,
            status,
            assurance: Assurance::for_integrity(integrity),
            checks: self.checks,
            errors: self.errors,
            warnings: vec![VerificationWarning {
                code: "INTERNAL_INTEGRITY_ONLY".to_owned(),
                message: "Package internal integrity is evaluated. Creator identity is not verified; digital signature and trusted timestamp are not present; originality is not evaluated.".to_owned(),
            }],
        }
    }
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
