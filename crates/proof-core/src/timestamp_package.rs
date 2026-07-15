use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use proof_schema::{TimeAssurance, TrustedTimestampDescriptor, VerificationStatus};
use tempfile::Builder;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::{
    CoreError, CoreResult, ErrorKind, ParsedTsaProfile, TimestampRequestDisclosure,
    VerificationLimits, build_timestamp_request, inspect_package, verify_package_with_profile,
    verify_timestamp_strict,
};

#[derive(Debug, Clone)]
pub struct PreparedTimestampRequest {
    pub timestamp_path: String,
    pub disclosure: TimestampRequestDisclosure,
}

#[derive(Debug, Clone)]
pub struct AttachTimestampResult {
    pub path: PathBuf,
    pub timestamp_path: String,
    pub gen_time: String,
}

pub fn prepare_timestamp_request(
    package: &Path,
    profile: &ParsedTsaProfile,
    limits: &VerificationLimits,
    verified_at: String,
) -> CoreResult<PreparedTimestampRequest> {
    let report = verify_package_with_profile(package, limits, verified_at, profile);
    require_valid_source(&report)?;
    let descriptor = timestamp_descriptor(package, limits)?;
    let signature = read_entry(
        package,
        &descriptor.signature_path,
        limits.max_signature_bytes,
    )?;
    let disclosure = build_timestamp_request(&signature, &descriptor.timestamp, profile)?;
    Ok(PreparedTimestampRequest {
        timestamp_path: descriptor.timestamp.timestamp_path,
        disclosure,
    })
}

pub fn attach_timestamp_response(
    package: &Path,
    output: &Path,
    response_der: &[u8],
    profile: &ParsedTsaProfile,
    limits: &VerificationLimits,
    verified_at: String,
) -> CoreResult<AttachTimestampResult> {
    if output.exists() {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "OUTPUT_ALREADY_EXISTS",
            "Timestamped package output already exists and will not be overwritten.",
        )
        .at_path(output));
    }
    if response_der.is_empty() || response_der.len() as u64 > limits.max_timestamp_response_bytes {
        return Err(timestamp_error(
            "TRUSTED_TIMESTAMP_SIZE_INVALID",
            "Timestamp response must contain between 1 byte and the configured response limit.",
        ));
    }
    let parent = output
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let metadata = fs::symlink_metadata(parent)
        .map_err(|error| CoreError::io("OUTPUT_DIRECTORY_INVALID", parent, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "OUTPUT_DIRECTORY_INVALID",
            "Output parent must be a real directory, not a symbolic link.",
        )
        .at_path(parent));
    }

    let source_report = verify_package_with_profile(package, limits, verified_at.clone(), profile);
    require_valid_source(&source_report)?;
    let descriptor = timestamp_descriptor(package, limits)?;
    let signature = read_entry(
        package,
        &descriptor.signature_path,
        limits.max_signature_bytes,
    )?;
    let verification = verify_timestamp_strict(
        response_der,
        &signature,
        &descriptor.timestamp,
        profile,
        &verified_at,
    );
    if verification.state != TimeAssurance::ValidTrusted {
        return Err(timestamp_error(verification.code, verification.message));
    }
    let gen_time = verification.evidence.gen_time.ok_or_else(|| {
        timestamp_error(
            "TRUSTED_TIMESTAMP_TIME_MISSING",
            "A valid timestamp verification did not produce a generation time.",
        )
    })?;

    let source = File::open(package)
        .map_err(|error| CoreError::io("PACKAGE_OPEN_FAILED", package, error))?;
    let mut archive = ZipArchive::new(source).map_err(|error| {
        CoreError::new(ErrorKind::PackageFormat, "MALFORMED_ZIP", error.to_string())
    })?;
    if archive
        .by_name(&descriptor.timestamp.timestamp_path)
        .is_ok()
    {
        return Err(timestamp_error(
            "TRUSTED_TIMESTAMP_ALREADY_ATTACHED",
            "The package already contains its predeclared timestamp response.",
        ));
    }
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-timestamp-")
        .tempfile_in(parent)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_FAILED", parent, error))?;
    {
        let mut writer = ZipWriter::new(temporary.as_file_mut());
        for index in 0..archive.len() {
            let entry = archive.by_index(index).map_err(CoreError::from)?;
            writer.raw_copy_file(entry).map_err(CoreError::from)?;
        }
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644)
            .large_file(response_der.len() >= u32::MAX as usize);
        writer
            .start_file(&descriptor.timestamp.timestamp_path, options)
            .map_err(CoreError::from)?;
        writer.write_all(response_der).map_err(|error| {
            CoreError::new(ErrorKind::Io, "PACKAGE_WRITE_FAILED", error.to_string())
        })?;
        writer.finish().map_err(CoreError::from)?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CoreError::io("PACKAGE_SYNC_FAILED", temporary.path(), error))?;

    let final_report = verify_package_with_profile(temporary.path(), limits, verified_at, profile);
    if final_report.status != VerificationStatus::Valid
        || final_report.assurance.trusted_time != TimeAssurance::ValidTrusted
    {
        let details = final_report
            .errors
            .iter()
            .map(|error| format!("{}: {}", error.code, error.message))
            .chain(
                final_report
                    .warnings
                    .iter()
                    .map(|warning| format!("{}: {}", warning.code, warning.message)),
            )
            .collect::<Vec<_>>()
            .join("; ");
        return Err(timestamp_error(
            "TIMESTAMPED_PACKAGE_SELF_CHECK_FAILED",
            details,
        ));
    }
    if output.exists() {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "OUTPUT_ALREADY_EXISTS",
            "Timestamped package output appeared during creation and will not be overwritten.",
        )
        .at_path(output));
    }
    temporary
        .persist_noclobber(output)
        .map_err(|error| CoreError::io("PACKAGE_PERSIST_FAILED", output, error.error))?;
    Ok(AttachTimestampResult {
        path: output.to_owned(),
        timestamp_path: descriptor.timestamp.timestamp_path,
        gen_time,
    })
}

struct PackageTimestampDescriptor {
    signature_path: String,
    timestamp: TrustedTimestampDescriptor,
}

fn timestamp_descriptor(
    package: &Path,
    limits: &VerificationLimits,
) -> CoreResult<PackageTimestampDescriptor> {
    let inspection = inspect_package(package, limits)?;
    let creator = inspection.creator_signature.ok_or_else(|| {
        timestamp_error(
            "CREATOR_SIGNATURE_METADATA_MISSING",
            "Timestamp acquisition requires a creator-signed package.",
        )
    })?;
    let timestamp = inspection.trusted_timestamp.ok_or_else(|| {
        timestamp_error(
            "TRUSTED_TIMESTAMP_PLAN_MISSING",
            "Package Manifest does not predeclare an RFC 3161 timestamp plan.",
        )
    })?;
    Ok(PackageTimestampDescriptor {
        signature_path: creator.signature_path,
        timestamp,
    })
}

fn read_entry(package: &Path, name: &str, limit: u64) -> CoreResult<Vec<u8>> {
    let source = File::open(package)
        .map_err(|error| CoreError::io("PACKAGE_OPEN_FAILED", package, error))?;
    let mut archive = ZipArchive::new(source).map_err(|error| {
        CoreError::new(ErrorKind::PackageFormat, "MALFORMED_ZIP", error.to_string())
    })?;
    let mut entry = archive.by_name(name).map_err(|_| {
        CoreError::new(
            ErrorKind::PackageFormat,
            "PACKAGE_ENTRY_MISSING",
            format!("Required package entry is missing: {name}"),
        )
    })?;
    if entry.size() > limit {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "PACKAGE_ENTRY_LIMIT_EXCEEDED",
            format!("Package entry exceeds its configured limit: {name}"),
        ));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .by_ref()
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| CoreError::io("PACKAGE_READ_FAILED", package, error))?;
    if bytes.len() as u64 > limit {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "PACKAGE_ENTRY_LIMIT_EXCEEDED",
            format!("Package entry exceeds its configured limit: {name}"),
        ));
    }
    Ok(bytes)
}

fn require_valid_source(report: &proof_schema::VerificationReport) -> CoreResult<()> {
    if report.status == VerificationStatus::Valid {
        return Ok(());
    }
    let details = report
        .errors
        .iter()
        .map(|error| format!("{}: {}", error.code, error.message))
        .collect::<Vec<_>>()
        .join("; ");
    Err(timestamp_error("TIMESTAMP_SOURCE_PACKAGE_INVALID", details))
}

fn timestamp_error(code: &'static str, message: impl Into<String>) -> CoreError {
    CoreError::new(ErrorKind::TrustedTime, code, message)
}
