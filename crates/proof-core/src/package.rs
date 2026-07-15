use std::fs::{self, File};
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use proof_schema::{
    CREATOR_KEY_PREFIX, CREATOR_SIGNATURE_PATH, CREATOR_SIGNATURE_PROFILE,
    CREATOR_SIGNATURE_PROFILE_V03, CreatorSignatureDescriptor, EventChainSummary, HASH_ALGORITHM,
    LEGACY_SCHEMA_VERSION, MANIFEST_PATH, Manifest, ManifestSecurity, SCHEMA_VERSION,
    SIGNED_SCHEMA_VERSION, TRUSTED_TIMESTAMP_PREFIX, TRUSTED_TIMESTAMP_PROFILE, ToolInfo,
    TrustedTimestampDescriptor, VerificationStatus, validate_manifest_schema,
};
use tempfile::Builder;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

use crate::hash::copy_and_hash;
use crate::signing::{
    SignatureArtifacts, SignerKeyStore, SignerService, SigningMaterial, random_signature_id,
    sign_manifest_with_profile,
};
use crate::timestamp::{ParsedTsaProfile, random_timestamp_nonce};
use crate::workspace::{events_path, load_events, workspace_asset_path};
use crate::{
    CoreError, CoreResult, ErrorKind, VerificationLimits, canonical_json, load_workspace,
    sha256_reader, verify_event_chain, verify_package,
};

#[derive(Debug)]
pub struct SealOptions {
    pub workspace: PathBuf,
    pub output: PathBuf,
    pub proof_id: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct SealResult {
    pub path: PathBuf,
    pub manifest: Manifest,
}

pub fn seal_workspace(options: SealOptions) -> CoreResult<SealResult> {
    seal_workspace_internal(options, None, None)
}

pub fn seal_signed_workspace<S: SignerKeyStore>(
    options: SealOptions,
    signer: &SignerService<S>,
) -> CoreResult<SealResult> {
    let material = signer.signing_material()?;
    seal_workspace_internal(options, Some(&material), None)
}

pub fn seal_signed_workspace_with_timestamp<S: SignerKeyStore>(
    options: SealOptions,
    signer: &SignerService<S>,
    profile: &ParsedTsaProfile,
    requested_policy: &str,
) -> CoreResult<SealResult> {
    if requested_policy != "any"
        && !profile
            .profile
            .allowed_policy_oids
            .iter()
            .any(|policy| policy == requested_policy)
    {
        return Err(CoreError::new(
            ErrorKind::TrustedTime,
            "TSA_PROFILE_POLICY_NOT_ALLOWED",
            "Requested timestamp policy is not allowed by the imported TSA profile.",
        ));
    }
    let material = signer.signing_material()?;
    seal_workspace_internal(options, Some(&material), Some((profile, requested_policy)))
}

fn seal_workspace_internal(
    options: SealOptions,
    signing: Option<&SigningMaterial>,
    timestamp: Option<(&ParsedTsaProfile, &str)>,
) -> CoreResult<SealResult> {
    if options.output.exists() {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "OUTPUT_ALREADY_EXISTS",
            "Seal output already exists and will not be overwritten.",
        )
        .at_path(&options.output));
    }
    let output_parent = parent_or_current(&options.output);
    require_output_directory(output_parent)?;

    let mut workspace = load_workspace(&options.workspace)?;
    workspace
        .assets
        .sort_by(|left, right| left.package_path.cmp(&right.package_path));
    if workspace.assets.is_empty() {
        return Err(CoreError::new(
            ErrorKind::MissingAsset,
            "MISSING_ASSET",
            "At least one asset is required before sealing.",
        ));
    }
    let limits = VerificationLimits::default();
    let structural_entries = if signing.is_some() { 4 } else { 2 };
    if workspace.assets.len().saturating_add(structural_entries) > limits.max_entries {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
            "Workspace contains too many assets to seal.",
        ));
    }
    let mut total_size = 0_u64;
    for asset in &workspace.assets {
        let path = workspace_asset_path(&options.workspace, asset)?;
        let mut source =
            File::open(&path).map_err(|error| CoreError::io("ASSET_OPEN_FAILED", &path, error))?;
        let mut limited = Read::take(&mut source, limits.max_single_entry_bytes.saturating_add(1));
        let digest = sha256_reader(&mut limited)?;
        if digest.size > limits.max_single_entry_bytes {
            return Err(CoreError::new(
                ErrorKind::LimitExceeded,
                "ASSET_SIZE_LIMIT_EXCEEDED",
                "Workspace asset exceeds the single-entry limit.",
            )
            .at_path(path));
        }
        if digest.size != asset.size_bytes {
            return Err(CoreError::new(
                ErrorKind::HashMismatch,
                "ASSET_SIZE_MISMATCH",
                "Workspace asset size differs from proof-workspace.json.",
            )
            .at_path(path));
        }
        if digest.sha256 != asset.sha256 {
            return Err(CoreError::new(
                ErrorKind::HashMismatch,
                "ASSET_HASH_MISMATCH",
                "Workspace asset SHA-256 differs from proof-workspace.json.",
            )
            .at_path(path));
        }
        total_size = total_size.checked_add(digest.size).ok_or_else(|| {
            CoreError::new(
                ErrorKind::LimitExceeded,
                "TOTAL_SIZE_OVERFLOW",
                "Workspace asset size overflow.",
            )
        })?;
    }
    if total_size > limits.max_total_uncompressed_bytes {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "TOTAL_SIZE_LIMIT_EXCEEDED",
            "Workspace assets exceed the total uncompressed limit.",
        ));
    }

    let events = load_events(&events_path(&options.workspace))?;
    let chain_issues = verify_event_chain(&events);
    if let Some(issue) = chain_issues.first() {
        return Err(CoreError::new(
            ErrorKind::InvalidEventChain,
            issue.code,
            issue.message.clone(),
        ));
    }
    let event_bytes = canonical_json(&events)?;
    if event_bytes.len() as u64 > limits.max_event_bytes {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "EVENT_JSON_LIMIT_EXCEEDED",
            "Event JSON exceeds the configured limit.",
        ));
    }
    let spec_version = if timestamp.is_some() {
        SCHEMA_VERSION
    } else if signing.is_some() {
        SIGNED_SCHEMA_VERSION
    } else {
        LEGACY_SCHEMA_VERSION
    };
    let security = signing.map(|material| {
        let signature_id = random_signature_id();
        ManifestSecurity {
            creator_signature: CreatorSignatureDescriptor {
                profile: if timestamp.is_some() {
                    CREATOR_SIGNATURE_PROFILE.to_owned()
                } else {
                    CREATOR_SIGNATURE_PROFILE_V03.to_owned()
                },
                signature_id: signature_id.clone(),
                display_label: material.display_label.clone(),
                key_fingerprint: material.key_fingerprint.clone(),
                public_key_path: format!("{CREATOR_KEY_PREFIX}{}.cbor", material.key_fingerprint),
                signature_path: CREATOR_SIGNATURE_PATH.to_owned(),
            },
            trusted_timestamp: timestamp.map(|(profile, requested_policy)| {
                TrustedTimestampDescriptor {
                    profile: TRUSTED_TIMESTAMP_PROFILE.to_owned(),
                    timestamp_path: format!("{TRUSTED_TIMESTAMP_PREFIX}{signature_id}.tsr"),
                    nonce: random_timestamp_nonce(),
                    requested_policy: requested_policy.to_owned(),
                    tsa_profile_sha256: profile.digest.clone(),
                }
            }),
        }
    });
    let manifest = Manifest {
        spec_version: spec_version.to_owned(),
        proof_id: options.proof_id,
        created_at: options.created_at.clone(),
        tool: ToolInfo {
            name: "aigc-proof".to_owned(),
            version: spec_version.to_owned(),
        },
        project: workspace.project,
        assets: workspace.assets,
        event_chain: EventChainSummary {
            algorithm: HASH_ALGORITHM.to_owned(),
            event_count: events.len() as u64,
            root_hash: events.last().map(|event| event.event_hash.clone()),
        },
        security,
    };
    validate_manifest(&manifest)?;
    let manifest_bytes = canonical_json(&manifest)?;
    if manifest_bytes.len() as u64 > limits.max_manifest_bytes {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "MANIFEST_LIMIT_EXCEEDED",
            "Manifest exceeds the configured limit.",
        ));
    }
    let signature_artifacts = signing
        .map(|material| {
            let profile = manifest
                .security
                .as_ref()
                .map(|security| security.creator_signature.profile.as_str())
                .unwrap_or(CREATOR_SIGNATURE_PROFILE_V03);
            sign_manifest_with_profile(material, &manifest_bytes, profile)
        })
        .transpose()?;

    let mut temporary = Builder::new()
        .prefix(".aigc-proof-package-")
        .tempfile_in(output_parent)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_FAILED", output_parent, error))?;
    write_zip(
        temporary.as_file_mut(),
        &options.workspace,
        &manifest,
        &manifest_bytes,
        &event_bytes,
        signature_artifacts.as_ref(),
    )?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CoreError::io("PACKAGE_SYNC_FAILED", temporary.path(), error))?;

    let self_check = verify_package(
        temporary.path(),
        &VerificationLimits::default(),
        options.created_at,
    );
    if self_check.status != VerificationStatus::Valid {
        let message = self_check
            .errors
            .iter()
            .map(|error| format!("{}: {}", error.code, error.message))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "PACKAGE_SELF_CHECK_FAILED",
            message,
        ));
    }
    if options.output.exists() {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "OUTPUT_ALREADY_EXISTS",
            "Seal output appeared during creation and will not be overwritten.",
        )
        .at_path(&options.output));
    }
    temporary
        .persist_noclobber(&options.output)
        .map_err(|error| CoreError::io("PACKAGE_PERSIST_FAILED", &options.output, error.error))?;
    Ok(SealResult {
        path: options.output,
        manifest,
    })
}

fn validate_manifest(manifest: &Manifest) -> CoreResult<()> {
    let issues = manifest.validate();
    if let Some(issue) = issues.first() {
        return Err(CoreError::new(
            ErrorKind::SchemaValidation,
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        ));
    }
    let value = serde_json::to_value(manifest).map_err(|error| {
        CoreError::new(
            ErrorKind::MalformedJson,
            "MANIFEST_SERIALIZATION_FAILED",
            error.to_string(),
        )
    })?;
    validate_manifest_schema(&value).map_err(|errors| {
        CoreError::new(
            ErrorKind::SchemaValidation,
            "MANIFEST_SCHEMA_INVALID",
            errors.join("; "),
        )
    })
}

fn write_zip(
    output: &mut File,
    workspace_root: &Path,
    manifest: &Manifest,
    manifest_bytes: &[u8],
    event_bytes: &[u8],
    signature_artifacts: Option<&SignatureArtifacts>,
) -> CoreResult<()> {
    let mut archive = zip::ZipWriter::new(output);
    start_entry(&mut archive, MANIFEST_PATH, manifest_bytes.len() as u64)?;
    archive.write_all(manifest_bytes).map_err(|error| {
        CoreError::new(ErrorKind::Io, "PACKAGE_WRITE_FAILED", error.to_string())
    })?;
    for asset in &manifest.assets {
        let path = workspace_asset_path(workspace_root, asset)?;
        let mut source =
            File::open(&path).map_err(|error| CoreError::io("ASSET_OPEN_FAILED", &path, error))?;
        start_entry(&mut archive, &asset.package_path, asset.size_bytes)?;
        let mut limited = Read::take(&mut source, asset.size_bytes.saturating_add(1));
        let digest = copy_and_hash(&mut limited, &mut archive)?;
        if digest.size != asset.size_bytes || digest.sha256 != asset.sha256 {
            return Err(CoreError::new(
                ErrorKind::HashMismatch,
                "ASSET_CHANGED_DURING_SEAL",
                "Asset changed while the proof package was being written.",
            )
            .at_path(path));
        }
    }
    start_entry(
        &mut archive,
        proof_schema::EVENTS_PATH,
        event_bytes.len() as u64,
    )?;
    archive.write_all(event_bytes).map_err(|error| {
        CoreError::new(ErrorKind::Io, "PACKAGE_WRITE_FAILED", error.to_string())
    })?;
    if let Some(artifacts) = signature_artifacts {
        let security = manifest.security.as_ref().ok_or_else(|| {
            CoreError::new(
                ErrorKind::Signing,
                "CREATOR_SIGNATURE_METADATA_MISSING",
                "Signed package Manifest is missing creator signature metadata.",
            )
        })?;
        start_entry(
            &mut archive,
            &security.creator_signature.public_key_path,
            artifacts.public_key_cose.len() as u64,
        )?;
        archive
            .write_all(&artifacts.public_key_cose)
            .map_err(|error| {
                CoreError::new(ErrorKind::Io, "PACKAGE_WRITE_FAILED", error.to_string())
            })?;
        start_entry(
            &mut archive,
            &security.creator_signature.signature_path,
            artifacts.signature_cose.len() as u64,
        )?;
        archive
            .write_all(&artifacts.signature_cose)
            .map_err(|error| {
                CoreError::new(ErrorKind::Io, "PACKAGE_WRITE_FAILED", error.to_string())
            })?;
    }
    archive.finish()?;
    Ok(())
}

fn start_entry<W: Write + Seek>(
    archive: &mut zip::ZipWriter<W>,
    name: &str,
    size: u64,
) -> CoreResult<()> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644)
        .large_file(size >= u32::MAX as u64);
    archive.start_file(name, options)?;
    Ok(())
}

fn require_output_directory(path: &Path) -> CoreResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| CoreError::io("OUTPUT_DIRECTORY_INVALID", path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CoreError::new(
            ErrorKind::PackageFormat,
            "OUTPUT_DIRECTORY_INVALID",
            "Output parent must be a real directory, not a symbolic link.",
        )
        .at_path(path));
    }
    Ok(())
}

fn parent_or_current(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}
