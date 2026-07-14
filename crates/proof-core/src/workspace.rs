use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use proof_schema::{
    Asset, AssetRole, Event, WORKSPACE_FILE, Workspace, parse_json_strict,
    validate_portable_basename, validate_uuid, validate_workspace_schema,
};
use serde_json::Value;
use tempfile::Builder;

use crate::hash::copy_and_hash;
use crate::{
    CoreError, CoreResult, ErrorKind, VerificationLimits, canonical_json, create_event,
    verify_event_chain,
};

const EVENTS_DIRECTORY: &str = "events";
const WORKSPACE_EVENTS_FILE: &str = "events/events.json";

#[derive(Debug)]
pub struct InitWorkspaceOptions {
    pub path: PathBuf,
    pub project_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug)]
pub struct AddAssetOptions {
    pub workspace: PathBuf,
    pub source: PathBuf,
    pub role: AssetRole,
    pub asset_id: String,
    pub media_type: String,
}

#[derive(Debug)]
pub struct RecordEventOptions {
    pub workspace: PathBuf,
    pub event_id: String,
    pub event_type: String,
    pub created_at: String,
    pub payload: Value,
}

#[derive(Debug)]
pub struct ExportWorkspaceOutputOptions {
    pub workspace: PathBuf,
    pub asset_id: String,
    pub output: PathBuf,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExportWorkspaceOutputResult {
    pub path: PathBuf,
    pub asset: Asset,
    pub size_bytes: u64,
    pub sha256: String,
}

pub fn init_workspace(options: InitWorkspaceOptions) -> CoreResult<Workspace> {
    if options.path.exists() {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "WORKSPACE_ALREADY_EXISTS",
            "Workspace path already exists and will not be overwritten.",
        )
        .at_path(&options.path));
    }
    let workspace = Workspace::new(options.created_at, options.project_name);
    let issues = workspace.validate();
    if let Some(issue) = issues.first() {
        return Err(CoreError::new(
            ErrorKind::InvalidWorkspace,
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        ));
    }
    fs::create_dir(&options.path)
        .map_err(|error| CoreError::io("WORKSPACE_CREATE_FAILED", &options.path, error))?;
    let result = initialize_workspace_contents(&options.path, &workspace);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&options.path);
        return Err(error);
    }
    Ok(workspace)
}

fn initialize_workspace_contents(root: &Path, workspace: &Workspace) -> CoreResult<()> {
    let assets = root.join("assets");
    let events = root.join(EVENTS_DIRECTORY);
    fs::create_dir(&assets)
        .map_err(|error| CoreError::io("WORKSPACE_CREATE_FAILED", &assets, error))?;
    fs::create_dir(&events)
        .map_err(|error| CoreError::io("WORKSPACE_CREATE_FAILED", &events, error))?;
    write_new_file(&root.join(WORKSPACE_FILE), &canonical_json(workspace)?)?;
    write_new_file(
        &root.join(WORKSPACE_EVENTS_FILE),
        &canonical_json(&Vec::<Event>::new())?,
    )?;
    Ok(())
}

pub fn load_workspace(root: &Path) -> CoreResult<Workspace> {
    require_real_directory(root, "INVALID_WORKSPACE")?;
    require_real_directory(&root.join("assets"), "INVALID_WORKSPACE")?;
    require_real_directory(&root.join(EVENTS_DIRECTORY), "INVALID_WORKSPACE")?;
    let path = root.join(WORKSPACE_FILE);
    let bytes = read_regular_file_limited(&path, 1024 * 1024)?;
    let value: Value = parse_json_strict(&bytes).map_err(|error| {
        CoreError::new(
            ErrorKind::MalformedJson,
            "WORKSPACE_JSON_MALFORMED",
            error.to_string(),
        )
        .at_path(&path)
    })?;
    if let Err(errors) = validate_workspace_schema(&value) {
        return Err(CoreError::new(
            ErrorKind::SchemaValidation,
            "WORKSPACE_SCHEMA_INVALID",
            errors.join("; "),
        )
        .at_path(&path));
    }
    let workspace: Workspace = serde_json::from_value(value).map_err(|error| {
        CoreError::new(
            ErrorKind::MalformedJson,
            "WORKSPACE_JSON_MALFORMED",
            error.to_string(),
        )
        .at_path(&path)
    })?;
    let issues = workspace.validate();
    if let Some(issue) = issues.first() {
        return Err(CoreError::new(
            ErrorKind::InvalidWorkspace,
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        )
        .at_path(&path));
    }
    Ok(workspace)
}

pub fn add_asset(options: AddAssetOptions) -> CoreResult<Asset> {
    validate_uuid(&options.asset_id).map_err(|message| {
        CoreError::new(ErrorKind::InvalidWorkspace, "INVALID_ASSET_ID", message)
    })?;
    let metadata = fs::symlink_metadata(&options.source)
        .map_err(|error| CoreError::io("ASSET_METADATA_FAILED", &options.source, error))?;
    if metadata.file_type().is_symlink() {
        return Err(CoreError::new(
            ErrorKind::SymbolicLinkEntry,
            "ASSET_SYMBOLIC_LINK_REJECTED",
            "Source assets must not be symbolic links.",
        )
        .at_path(&options.source));
    }
    if !metadata.is_file() {
        return Err(CoreError::new(
            ErrorKind::MissingAsset,
            "ASSET_NOT_REGULAR_FILE",
            "Source asset must be a regular file.",
        )
        .at_path(&options.source));
    }
    let limits = VerificationLimits::default();
    if metadata.len() > limits.max_single_entry_bytes {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "ASSET_SIZE_LIMIT_EXCEEDED",
            "Source asset exceeds the single-entry limit.",
        )
        .at_path(&options.source));
    }
    let mut workspace = load_workspace(&options.workspace)?;
    let existing_total = workspace.assets.iter().try_fold(0_u64, |total, asset| {
        total.checked_add(asset.size_bytes).ok_or_else(|| {
            CoreError::new(
                ErrorKind::LimitExceeded,
                "TOTAL_SIZE_OVERFLOW",
                "Workspace asset size overflow.",
            )
        })
    })?;
    if existing_total
        .checked_add(metadata.len())
        .is_none_or(|total| total > limits.max_total_uncompressed_bytes)
    {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "TOTAL_SIZE_LIMIT_EXCEEDED",
            "Workspace assets exceed the total uncompressed limit.",
        ));
    }
    let original_name = options
        .source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            CoreError::new(
                ErrorKind::InvalidPackagePath,
                "INVALID_ORIGINAL_NAME",
                "Source filename must be valid UTF-8.",
            )
        })?
        .to_owned();
    validate_original_name(&original_name)?;
    let role = options.role.to_string();
    let package_path = format!("assets/{role}/{}-{original_name}", options.asset_id);
    proof_schema::validate_package_path(&package_path).map_err(|message| {
        CoreError::new(
            ErrorKind::InvalidPackagePath,
            "INVALID_PACKAGE_PATH",
            message,
        )
    })?;
    if workspace
        .assets
        .iter()
        .any(|asset| asset.package_path.eq_ignore_ascii_case(&package_path))
    {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "ASSET_PATH_ALREADY_EXISTS",
            "An asset with the same package path already exists.",
        ));
    }
    let destination = options.workspace.join(&package_path);
    let parent = destination.parent().ok_or_else(|| {
        CoreError::new(
            ErrorKind::InvalidPackagePath,
            "INVALID_PACKAGE_PATH",
            "Asset package path has no parent directory.",
        )
    })?;
    ensure_real_directory(parent)?;
    if destination.exists() {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "ASSET_DESTINATION_EXISTS",
            "Workspace asset destination already exists.",
        )
        .at_path(&destination));
    }
    let mut source = File::open(&options.source)
        .map_err(|error| CoreError::io("ASSET_OPEN_FAILED", &options.source, error))?;
    let opened_metadata = source
        .metadata()
        .map_err(|error| CoreError::io("ASSET_METADATA_FAILED", &options.source, error))?;
    if !opened_metadata.is_file() {
        return Err(CoreError::new(
            ErrorKind::MissingAsset,
            "ASSET_NOT_REGULAR_FILE",
            "Opened source asset must be a regular file.",
        )
        .at_path(&options.source));
    }
    let remaining_total = limits
        .max_total_uncompressed_bytes
        .checked_sub(existing_total)
        .ok_or_else(|| {
            CoreError::new(
                ErrorKind::LimitExceeded,
                "TOTAL_SIZE_LIMIT_EXCEEDED",
                "Workspace assets exceed the total uncompressed limit.",
            )
        })?;
    let copy_limit = limits.max_single_entry_bytes.min(remaining_total);
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-asset-")
        .tempfile_in(parent)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_FAILED", parent, error))?;
    let mut limited_source = Read::take(&mut source, copy_limit.saturating_add(1));
    let digest = copy_and_hash(&mut limited_source, temporary.as_file_mut())?;
    if digest.size > copy_limit {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "ASSET_SIZE_LIMIT_EXCEEDED",
            "Source asset exceeded a workspace size limit while it was being copied.",
        )
        .at_path(&options.source));
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CoreError::io("TEMPORARY_FILE_SYNC_FAILED", temporary.path(), error))?;
    temporary
        .persist_noclobber(&destination)
        .map_err(|error| CoreError::io("ASSET_PERSIST_FAILED", &destination, error.error))?;
    let asset = Asset {
        asset_id: options.asset_id,
        role: options.role,
        package_path,
        original_name,
        media_type: options.media_type,
        size_bytes: digest.size,
        sha256: digest.sha256,
    };
    workspace.assets.push(asset.clone());
    workspace
        .assets
        .sort_by(|left, right| left.package_path.cmp(&right.package_path));
    if let Err(error) = write_workspace(&options.workspace, &workspace) {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok(asset)
}

pub fn export_workspace_output(
    options: ExportWorkspaceOutputOptions,
) -> CoreResult<ExportWorkspaceOutputResult> {
    if options.output.exists() {
        return Err(CoreError::new(
            ErrorKind::OutputAlreadyExists,
            "OUTPUT_ALREADY_EXISTS",
            "Output path already exists and will not be overwritten.",
        )
        .at_path(&options.output));
    }
    let workspace = load_workspace(&options.workspace)?;
    let asset = workspace
        .assets
        .iter()
        .find(|asset| asset.asset_id == options.asset_id)
        .cloned()
        .ok_or_else(|| {
            CoreError::new(
                ErrorKind::MissingAsset,
                "OUTPUT_ASSET_NOT_FOUND",
                "The creation output asset is not present in the workspace.",
            )
        })?;
    if asset.role != AssetRole::Output {
        return Err(CoreError::new(
            ErrorKind::InvalidWorkspace,
            "ASSET_ROLE_NOT_OUTPUT",
            "Only an asset recorded with role output can be exported as a creation result.",
        ));
    }
    let source_path = workspace_asset_path(&options.workspace, &asset)?;
    let mut source = File::open(&source_path)
        .map_err(|error| CoreError::io("ASSET_OPEN_FAILED", &source_path, error))?;
    let opened_metadata = source
        .metadata()
        .map_err(|error| CoreError::io("ASSET_METADATA_FAILED", &source_path, error))?;
    if !opened_metadata.is_file() || opened_metadata.len() != asset.size_bytes {
        return Err(CoreError::new(
            ErrorKind::HashMismatch,
            "ASSET_SIZE_MISMATCH",
            "Workspace output size differs from the recorded output asset.",
        )
        .at_path(&source_path));
    }

    let output_parent = options.output.parent().ok_or_else(|| {
        CoreError::new(
            ErrorKind::InvalidPackagePath,
            "INVALID_OUTPUT_PATH",
            "Output path has no parent directory.",
        )
    })?;
    require_real_directory(output_parent, "INVALID_OUTPUT_DIRECTORY")?;
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-output-")
        .tempfile_in(output_parent)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_FAILED", output_parent, error))?;
    let digest = {
        let mut limited = Read::take(&mut source, asset.size_bytes.saturating_add(1));
        copy_and_hash(&mut limited, temporary.as_file_mut())?
    };
    if digest.size != asset.size_bytes || digest.sha256 != asset.sha256 {
        return Err(CoreError::new(
            ErrorKind::HashMismatch,
            "ASSET_HASH_MISMATCH",
            "Workspace output bytes differ from the recorded output asset.",
        )
        .at_path(&source_path));
    }
    let after_metadata = source
        .metadata()
        .map_err(|error| CoreError::io("ASSET_METADATA_FAILED", &source_path, error))?;
    if after_metadata.len() != digest.size {
        return Err(CoreError::new(
            ErrorKind::HashMismatch,
            "ASSET_CHANGED_DURING_EXPORT",
            "Workspace output changed while it was being exported.",
        )
        .at_path(&source_path));
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CoreError::io("TEMPORARY_FILE_SYNC_FAILED", temporary.path(), error))?;
    if let Err(error) = temporary.persist_noclobber(&options.output) {
        let code = if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            "OUTPUT_ALREADY_EXISTS"
        } else {
            "OUTPUT_EXPORT_FAILED"
        };
        return Err(CoreError::io(code, &options.output, error.error));
    }
    Ok(ExportWorkspaceOutputResult {
        path: options.output,
        asset,
        size_bytes: digest.size,
        sha256: digest.sha256,
    })
}

pub fn record_event(options: RecordEventOptions) -> CoreResult<Event> {
    load_workspace(&options.workspace)?;
    if !options.payload.is_object() {
        return Err(CoreError::new(
            ErrorKind::MalformedJson,
            "EVENT_PAYLOAD_NOT_OBJECT",
            "Event payload file must contain a JSON object.",
        ));
    }
    let events_path = options.workspace.join(WORKSPACE_EVENTS_FILE);
    let mut events = load_events(&events_path)?;
    let chain_issues = verify_event_chain(&events);
    if let Some(issue) = chain_issues.first() {
        return Err(CoreError::new(
            ErrorKind::InvalidEventChain,
            issue.code,
            issue.message.clone(),
        )
        .at_path(&events_path));
    }
    let event = create_event(
        &events,
        options.event_id,
        options.event_type,
        options.created_at,
        options.payload,
    )?;
    events.push(event.clone());
    write_atomic_replace(&events_path, &canonical_json(&events)?)?;
    Ok(event)
}

pub(crate) fn load_events(path: &Path) -> CoreResult<Vec<Event>> {
    let limit = VerificationLimits::default().max_event_bytes;
    let bytes = read_regular_file_limited(path, limit)?;
    parse_json_strict(&bytes).map_err(|error| {
        CoreError::new(
            ErrorKind::MalformedJson,
            "EVENT_JSON_MALFORMED",
            error.to_string(),
        )
        .at_path(path)
    })
}

pub(crate) fn workspace_asset_path(root: &Path, asset: &Asset) -> CoreResult<PathBuf> {
    proof_schema::validate_package_path(&asset.package_path).map_err(|message| {
        CoreError::new(
            ErrorKind::InvalidPackagePath,
            "INVALID_PACKAGE_PATH",
            message,
        )
    })?;
    require_real_directory(root, "INVALID_WORKSPACE")?;
    require_real_directory(&root.join("assets"), "INVALID_ASSET_DIRECTORY")?;
    let path = root.join(&asset.package_path);
    let parent = path.parent().ok_or_else(|| {
        CoreError::new(
            ErrorKind::InvalidPackagePath,
            "INVALID_PACKAGE_PATH",
            "Workspace asset path has no parent directory.",
        )
    })?;
    require_real_directory(parent, "INVALID_ASSET_DIRECTORY")?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| CoreError::io("ASSET_MISSING", &path, error))?;
    if metadata.file_type().is_symlink() {
        return Err(CoreError::new(
            ErrorKind::SymbolicLinkEntry,
            "ASSET_SYMBOLIC_LINK_REJECTED",
            "Workspace asset must not be a symbolic link.",
        )
        .at_path(&path));
    }
    if !metadata.is_file() {
        return Err(CoreError::new(
            ErrorKind::MissingAsset,
            "ASSET_NOT_REGULAR_FILE",
            "Workspace asset must be a regular file.",
        )
        .at_path(&path));
    }
    Ok(path)
}

pub(crate) fn events_path(root: &Path) -> PathBuf {
    root.join(WORKSPACE_EVENTS_FILE)
}

fn write_workspace(root: &Path, workspace: &Workspace) -> CoreResult<()> {
    let issues = workspace.validate();
    if let Some(issue) = issues.first() {
        return Err(CoreError::new(
            ErrorKind::InvalidWorkspace,
            issue.code,
            format!("{}: {}", issue.field, issue.message),
        ));
    }
    let value = serde_json::to_value(workspace).map_err(|error| {
        CoreError::new(
            ErrorKind::MalformedJson,
            "WORKSPACE_SERIALIZATION_FAILED",
            error.to_string(),
        )
    })?;
    if let Err(errors) = validate_workspace_schema(&value) {
        return Err(CoreError::new(
            ErrorKind::SchemaValidation,
            "WORKSPACE_SCHEMA_INVALID",
            errors.join("; "),
        ));
    }
    write_atomic_replace(&root.join(WORKSPACE_FILE), &canonical_json(workspace)?)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    let parent = path.parent().ok_or_else(|| {
        CoreError::new(
            ErrorKind::InvalidWorkspace,
            "INVALID_WORKSPACE_PATH",
            "Workspace file has no parent directory.",
        )
    })?;
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-")
        .tempfile_in(parent)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_FAILED", parent, error))?;
    temporary
        .write_all(bytes)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_WRITE_FAILED", temporary.path(), error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CoreError::io("TEMPORARY_FILE_SYNC_FAILED", temporary.path(), error))?;
    temporary
        .persist_noclobber(path)
        .map_err(|error| CoreError::io("OUTPUT_ALREADY_EXISTS", path, error.error))?;
    Ok(())
}

fn write_atomic_replace(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    let parent = path.parent().ok_or_else(|| {
        CoreError::new(
            ErrorKind::InvalidWorkspace,
            "INVALID_WORKSPACE_PATH",
            "Workspace file has no parent directory.",
        )
    })?;
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-")
        .tempfile_in(parent)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_FAILED", parent, error))?;
    temporary
        .write_all(bytes)
        .map_err(|error| CoreError::io("TEMPORARY_FILE_WRITE_FAILED", temporary.path(), error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| CoreError::io("TEMPORARY_FILE_SYNC_FAILED", temporary.path(), error))?;
    temporary
        .persist(path)
        .map_err(|error| CoreError::io("WORKSPACE_UPDATE_FAILED", path, error.error))?;
    Ok(())
}

fn read_regular_file_limited(path: &Path, limit: u64) -> CoreResult<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| CoreError::io("FILE_METADATA_FAILED", path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CoreError::new(
            ErrorKind::InvalidWorkspace,
            "WORKSPACE_FILE_NOT_REGULAR",
            "Workspace metadata must be a regular file, not a symbolic link.",
        )
        .at_path(path));
    }
    if metadata.len() > limit {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "WORKSPACE_FILE_LIMIT_EXCEEDED",
            "Workspace metadata exceeds its size limit.",
        )
        .at_path(path));
    }
    let file = File::open(path).map_err(|error| CoreError::io("FILE_OPEN_FAILED", path, error))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| CoreError::io("FILE_READ_FAILED", path, error))?;
    if bytes.len() as u64 > limit {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "WORKSPACE_FILE_LIMIT_EXCEEDED",
            "Workspace metadata exceeds its size limit.",
        )
        .at_path(path));
    }
    Ok(bytes)
}

fn require_real_directory(path: &Path, code: &'static str) -> CoreResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| CoreError::io(code, path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CoreError::new(
            ErrorKind::InvalidWorkspace,
            code,
            "Expected a real directory, not a symbolic link.",
        )
        .at_path(path));
    }
    Ok(())
}

fn ensure_real_directory(path: &Path) -> CoreResult<()> {
    if path.exists() {
        return require_real_directory(path, "INVALID_ASSET_DIRECTORY");
    }
    let parent = path.parent().ok_or_else(|| {
        CoreError::new(
            ErrorKind::InvalidWorkspace,
            "INVALID_ASSET_DIRECTORY",
            "Asset directory has no parent.",
        )
    })?;
    require_real_directory(parent, "INVALID_ASSET_DIRECTORY")?;
    fs::create_dir(path)
        .map_err(|error| CoreError::io("ASSET_DIRECTORY_CREATE_FAILED", path, error))
}

fn validate_original_name(value: &str) -> CoreResult<()> {
    validate_portable_basename(value).map_err(|message| {
        CoreError::new(
            ErrorKind::InvalidPackagePath,
            "INVALID_ORIGINAL_NAME",
            message,
        )
    })
}

pub fn media_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("txt") => "text/plain",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        _ => "application/octet-stream",
    }
}
