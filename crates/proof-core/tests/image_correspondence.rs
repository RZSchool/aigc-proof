use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use proof_core::{
    AddAssetOptions, ExportWorkspaceOutputOptions, InitWorkspaceOptions, SealOptions,
    VerificationLimits, add_asset, export_workspace_output, init_workspace, match_image_to_package,
    seal_workspace,
};
use proof_schema::{AssetRole, VerificationStatus};
use tempfile::tempdir;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

const NOW: &str = "2026-07-14T08:00:00Z";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nverified image bytes";

fn create_package(role: AssetRole) -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let root = tempdir().unwrap();
    let workspace = root.path().join("工作区");
    let image = root.path().join("生成 图片.png");
    let package = root.path().join("proof.aigcproof");
    fs::write(&image, PNG).unwrap();
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: Some("图片核验".to_owned()),
        created_at: NOW.to_owned(),
    })
    .unwrap();
    add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source: image.clone(),
        role,
        asset_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
        media_type: "image/png".to_owned(),
    })
    .unwrap();
    seal_workspace(SealOptions {
        workspace,
        output: package.clone(),
        proof_id: "urn:uuid:550e8400-e29b-41d4-a716-446655440001".to_owned(),
        created_at: NOW.to_owned(),
    })
    .unwrap();
    (root, image, package)
}

#[test]
fn exact_and_renamed_output_images_match_only_after_package_verification() {
    let (root, image, package) = create_package(AssetRole::Output);
    let renamed = root.path().join("重命名.jpg.png");
    fs::copy(&image, &renamed).unwrap();

    for candidate in [&image, &renamed] {
        let result = match_image_to_package(
            &package,
            candidate,
            &VerificationLimits::default(),
            NOW.to_owned(),
        )
        .unwrap();
        assert_eq!(
            result.status,
            proof_core::PackageAssetMatchStatus::VerifiedOutputMatch
        );
        assert_eq!(result.verification.status, VerificationStatus::Valid);
        assert_eq!(result.file_media_type.as_deref(), Some("image/png"));
        assert_eq!(result.matched_assets.len(), 1);
        assert_eq!(result.matched_assets[0].role, AssetRole::Output);
    }
}

#[test]
fn mismatch_non_output_and_invalid_package_have_distinct_results() {
    let (root, image, input_package) = create_package(AssetRole::Input);
    let input_match = match_image_to_package(
        &input_package,
        &image,
        &VerificationLimits::default(),
        NOW.to_owned(),
    )
    .unwrap();
    assert_eq!(
        input_match.status,
        proof_core::PackageAssetMatchStatus::MatchedNonOutput
    );

    let different = root.path().join("different.png");
    fs::write(&different, b"\x89PNG\r\n\x1a\ndifferent image").unwrap();
    let mismatch = match_image_to_package(
        &input_package,
        &different,
        &VerificationLimits::default(),
        NOW.to_owned(),
    )
    .unwrap();
    assert_eq!(
        mismatch.status,
        proof_core::PackageAssetMatchStatus::NotInPackage
    );
    assert!(mismatch.matched_assets.is_empty());

    let invalid = root.path().join("invalid.aigcproof");
    fs::write(&invalid, b"not a zip").unwrap();
    let invalid_result = match_image_to_package(
        &invalid,
        &image,
        &VerificationLimits::default(),
        NOW.to_owned(),
    )
    .unwrap();
    assert_eq!(
        invalid_result.status,
        proof_core::PackageAssetMatchStatus::PackageInvalid
    );
    assert_eq!(
        invalid_result.verification.status,
        VerificationStatus::Invalid
    );
    assert_eq!(invalid_result.file_sha256, None);
}

#[test]
fn tampered_package_never_produces_an_image_match_claim() {
    let (root, image, package) = create_package(AssetRole::Output);
    let tampered = root.path().join("tampered.aigcproof");
    rewrite_zip(&package, &tampered, |name, mut bytes| {
        if name.starts_with("assets/") {
            bytes.push(b'!');
        }
        bytes
    });
    let result = match_image_to_package(
        &tampered,
        &image,
        &VerificationLimits::default(),
        NOW.to_owned(),
    )
    .unwrap();
    assert_eq!(
        result.status,
        proof_core::PackageAssetMatchStatus::PackageInvalid
    );
    assert_eq!(result.verification.status, VerificationStatus::Invalid);
    assert!(result.file_sha256.is_none());
    assert!(result.matched_assets.is_empty());
}

#[test]
fn workspace_output_export_revalidates_bytes_and_never_clobbers() {
    let (root, _image, _package) = create_package(AssetRole::Output);
    let workspace = root.path().join("工作区");
    let output = root.path().join("保存 图片.png");
    let options = || ExportWorkspaceOutputOptions {
        workspace: workspace.clone(),
        asset_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
        output: output.clone(),
    };
    let exported = export_workspace_output(options()).unwrap();
    assert_eq!(fs::read(&output).unwrap(), PNG);
    assert_eq!(exported.asset.role, AssetRole::Output);
    assert_eq!(exported.size_bytes, PNG.len() as u64);
    assert_eq!(
        export_workspace_output(options()).unwrap_err().code,
        "OUTPUT_ALREADY_EXISTS"
    );

    let workspace_asset = workspace.join(exported.asset.package_path);
    fs::write(&workspace_asset, b"\x89PNG\r\n\x1a\ntampered").unwrap();
    let second = root.path().join("second.png");
    let error = export_workspace_output(ExportWorkspaceOutputOptions {
        output: second.clone(),
        ..options()
    })
    .unwrap_err();
    assert!(matches!(
        error.code,
        "ASSET_SIZE_MISMATCH" | "ASSET_HASH_MISMATCH"
    ));
    assert!(!second.exists());
}

#[test]
fn unsupported_image_bytes_are_rejected_after_valid_package_verification() {
    let (root, _image, package) = create_package(AssetRole::Output);
    let text = root.path().join("fake.png");
    fs::write(&text, b"plain text").unwrap();
    assert_eq!(
        match_image_to_package(
            &package,
            &text,
            &VerificationLimits::default(),
            NOW.to_owned(),
        )
        .unwrap_err()
        .code,
        "IMAGE_TYPE_UNSUPPORTED"
    );
}

#[test]
fn external_image_limits_and_non_regular_files_fail_closed() {
    let (root, _image, package) = create_package(AssetRole::Output);
    let oversized = root.path().join("oversized.png");
    let mut oversized_bytes = vec![0_u8; 2 * 1024 * 1024];
    oversized_bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    fs::write(&oversized, oversized_bytes).unwrap();
    let limits = VerificationLimits {
        max_single_entry_bytes: 1024 * 1024,
        ..VerificationLimits::default()
    };
    assert_eq!(
        match_image_to_package(&package, &oversized, &limits, NOW.to_owned())
            .unwrap_err()
            .code,
        "IMAGE_SIZE_LIMIT_EXCEEDED"
    );
    assert_eq!(
        match_image_to_package(
            &package,
            root.path(),
            &VerificationLimits::default(),
            NOW.to_owned(),
        )
        .unwrap_err()
        .code,
        "IMAGE_NOT_REGULAR_FILE"
    );
}

#[test]
fn image_mutation_during_streaming_is_an_operational_failure() {
    let (root, _image, package) = create_package(AssetRole::Output);
    let changing = root.path().join("changing.png");
    let mut bytes = vec![0_u8; 64 * 1024 * 1024];
    bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    fs::write(&changing, bytes).unwrap();

    let stop = Arc::new(AtomicBool::new(false));
    let writer_stop = Arc::clone(&stop);
    let writer_path = changing.clone();
    let writer = std::thread::spawn(move || {
        let mut file = OpenOptions::new().write(true).open(writer_path).unwrap();
        let mut value = 0_u8;
        while !writer_stop.load(Ordering::Relaxed) {
            file.seek(SeekFrom::Start(32 * 1024 * 1024)).unwrap();
            value ^= 1;
            file.write_all(&[value]).unwrap();
            file.sync_data().unwrap();
        }
    });
    std::thread::yield_now();
    let result = match_image_to_package(
        &package,
        &changing,
        &VerificationLimits::default(),
        NOW.to_owned(),
    );
    stop.store(true, Ordering::Relaxed);
    writer.join().unwrap();
    assert_eq!(result.unwrap_err().code, "IMAGE_CHANGED_DURING_READ");
}

#[cfg(unix)]
#[test]
fn image_symlink_is_rejected() {
    use std::os::unix::fs::symlink;

    let (root, image, package) = create_package(AssetRole::Output);
    let link = root.path().join("linked.png");
    symlink(&image, &link).unwrap();
    assert_eq!(
        match_image_to_package(
            &package,
            &link,
            &VerificationLimits::default(),
            NOW.to_owned(),
        )
        .unwrap_err()
        .code,
        "IMAGE_SYMBOLIC_LINK_REJECTED"
    );
}

fn rewrite_zip(
    source: &std::path::Path,
    destination: &std::path::Path,
    mutate: impl Fn(&str, Vec<u8>) -> Vec<u8>,
) {
    let input = File::open(source).unwrap();
    let mut archive = zip::ZipArchive::new(input).unwrap();
    let output = File::create(destination).unwrap();
    let mut writer = zip::ZipWriter::new(output);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        let bytes = mutate(&name, bytes);
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(&bytes).unwrap();
    }
    writer.finish().unwrap();
}
