use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::SystemTime;

use proof_schema::{Asset, AssetRole, VerificationReport};
use serde::{Deserialize, Serialize};

use crate::verify::verify_package_with_manifest;
use crate::{CoreError, CoreResult, ErrorKind, VerificationLimits, sha256_reader};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackageAssetMatchStatus {
    VerifiedOutputMatch,
    MatchedNonOutput,
    NotInPackage,
    PackageInvalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PackageAssetMatch {
    pub status: PackageAssetMatchStatus,
    pub verification: VerificationReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_sha256: Option<String>,
    pub matched_assets: Vec<Asset>,
}

pub fn match_image_to_package(
    package: &Path,
    image: &Path,
    limits: &VerificationLimits,
    verified_at: String,
) -> CoreResult<PackageAssetMatch> {
    let (verification, manifest) = verify_package_with_manifest(package, limits, verified_at);
    let Some(manifest) = manifest else {
        return Ok(PackageAssetMatch {
            status: PackageAssetMatchStatus::PackageInvalid,
            verification,
            file_media_type: None,
            file_size_bytes: None,
            file_sha256: None,
            matched_assets: Vec::new(),
        });
    };

    let metadata = fs::symlink_metadata(image)
        .map_err(|error| CoreError::io("IMAGE_METADATA_FAILED", image, error))?;
    if metadata.file_type().is_symlink() {
        return Err(CoreError::new(
            ErrorKind::SymbolicLinkEntry,
            "IMAGE_SYMBOLIC_LINK_REJECTED",
            "The selected image must not be a symbolic link.",
        )
        .at_path(image));
    }
    if !metadata.is_file() {
        return Err(CoreError::new(
            ErrorKind::MissingAsset,
            "IMAGE_NOT_REGULAR_FILE",
            "The selected image must be a regular file.",
        )
        .at_path(image));
    }
    if metadata.len() > limits.max_single_entry_bytes {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "IMAGE_SIZE_LIMIT_EXCEEDED",
            "The selected image exceeds the single-entry limit.",
        )
        .at_path(image));
    }

    let mut file =
        File::open(image).map_err(|error| CoreError::io("IMAGE_OPEN_FAILED", image, error))?;
    let opened_metadata = file
        .metadata()
        .map_err(|error| CoreError::io("IMAGE_METADATA_FAILED", image, error))?;
    if !opened_metadata.is_file() {
        return Err(CoreError::new(
            ErrorKind::MissingAsset,
            "IMAGE_NOT_REGULAR_FILE",
            "The opened image must be a regular file.",
        )
        .at_path(image));
    }
    if opened_metadata.len() > limits.max_single_entry_bytes {
        return Err(CoreError::new(
            ErrorKind::LimitExceeded,
            "IMAGE_SIZE_LIMIT_EXCEEDED",
            "The selected image exceeds the single-entry limit.",
        )
        .at_path(image));
    }
    let media_type = detect_image_media_type(&mut file, image)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| CoreError::io("IMAGE_SEEK_FAILED", image, error))?;
    let digest = {
        let mut limited = Read::take(&mut file, limits.max_single_entry_bytes.saturating_add(1));
        let digest = sha256_reader(&mut limited)?;
        if digest.size > limits.max_single_entry_bytes {
            return Err(CoreError::new(
                ErrorKind::LimitExceeded,
                "IMAGE_SIZE_LIMIT_EXCEEDED",
                "The selected image changed or exceeded the limit while it was read.",
            )
            .at_path(image));
        }
        digest
    };
    let after_metadata = file
        .metadata()
        .map_err(|error| CoreError::io("IMAGE_METADATA_FAILED", image, error))?;
    let path_after_metadata = fs::symlink_metadata(image)
        .map_err(|error| CoreError::io("IMAGE_METADATA_FAILED", image, error))?;
    if path_after_metadata.file_type().is_symlink()
        || !path_after_metadata.is_file()
        || metadata_changed(&opened_metadata, &after_metadata)
        || metadata_changed(&opened_metadata, &path_after_metadata)
        || opened_metadata.len() != digest.size
        || after_metadata.len() != digest.size
    {
        return Err(CoreError::new(
            ErrorKind::HashMismatch,
            "IMAGE_CHANGED_DURING_READ",
            "The selected image changed while it was being hashed.",
        )
        .at_path(image));
    }

    let matched_assets = manifest
        .assets
        .into_iter()
        .filter(|asset| asset.size_bytes == digest.size && asset.sha256 == digest.sha256)
        .collect::<Vec<_>>();
    let status = if matched_assets
        .iter()
        .any(|asset| asset.role == AssetRole::Output)
    {
        PackageAssetMatchStatus::VerifiedOutputMatch
    } else if matched_assets.is_empty() {
        PackageAssetMatchStatus::NotInPackage
    } else {
        PackageAssetMatchStatus::MatchedNonOutput
    };

    Ok(PackageAssetMatch {
        status,
        verification,
        file_media_type: Some(media_type.to_owned()),
        file_size_bytes: Some(digest.size),
        file_sha256: Some(digest.sha256),
        matched_assets,
    })
}

fn metadata_changed(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    fn timestamp(value: std::io::Result<SystemTime>) -> Option<SystemTime> {
        value.ok()
    }

    before.len() != after.len()
        || timestamp(before.modified()) != timestamp(after.modified())
        || timestamp(before.created()) != timestamp(after.created())
}

fn detect_image_media_type(file: &mut File, path: &Path) -> CoreResult<&'static str> {
    let mut header = [0_u8; 12];
    let mut read = 0;
    while read < header.len() {
        let count = file
            .read(&mut header[read..])
            .map_err(|error| CoreError::io("IMAGE_READ_FAILED", path, error))?;
        if count == 0 {
            break;
        }
        read += count;
    }
    if read >= 8 && header[..8] == *b"\x89PNG\r\n\x1a\n" {
        return Ok("image/png");
    }
    if read >= 3 && header[..3] == [0xff, 0xd8, 0xff] {
        return Ok("image/jpeg");
    }
    if read >= 12 && header[..4] == *b"RIFF" && header[8..12] == *b"WEBP" {
        return Ok("image/webp");
    }
    Err(CoreError::new(
        ErrorKind::PackageFormat,
        "IMAGE_TYPE_UNSUPPORTED",
        "Only PNG, JPEG and WebP image bytes are supported.",
    )
    .at_path(path))
}
