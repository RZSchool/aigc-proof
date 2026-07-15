use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use proof_core::{
    AddAssetOptions, InitWorkspaceOptions, RecordEventOptions, SealOptions, VerificationLimits,
    add_asset, canonical_json, init_workspace, inspect_package, record_event, seal_workspace,
    verify_package,
};
use proof_schema::{AssetRole, VerificationStatus, validate_verification_result_schema};
use serde_json::{Value, json};
use tempfile::TempDir;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

const NOW: &str = "2026-07-10T12:30:45Z";
const ASSET_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
const EVENT_ID: &str = "550e8400-e29b-41d4-a716-446655440001";
const PROOF_ID: &str = "urn:uuid:550e8400-e29b-41d4-a716-446655440002";

fn create_valid(root: &Path) -> PathBuf {
    let workspace = root.join("workspace");
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: Some("test".to_owned()),
        created_at: NOW.to_owned(),
    })
    .unwrap();
    let source = root.join("asset.txt");
    fs::write(&source, b"proof asset").unwrap();
    add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source,
        role: AssetRole::Input,
        asset_id: ASSET_ID.to_owned(),
        media_type: "text/plain".to_owned(),
    })
    .unwrap();
    record_event(RecordEventOptions {
        workspace: workspace.clone(),
        event_id: EVENT_ID.to_owned(),
        event_type: "generation".to_owned(),
        created_at: NOW.to_owned(),
        payload: json!({"model": "demo"}),
    })
    .unwrap();
    let output = root.join("valid.aigcproof");
    seal_workspace(SealOptions {
        workspace,
        output: output.clone(),
        proof_id: PROOF_ID.to_owned(),
        created_at: NOW.to_owned(),
    })
    .unwrap();
    output
}

#[test]
fn workspace_package_and_report_verify_offline() {
    let temp = TempDir::new().unwrap();
    let package = create_valid(temp.path());
    let report = verify_package(&package, &VerificationLimits::default(), NOW.to_owned());
    assert_eq!(report.status, VerificationStatus::Valid);
    assert!(report.errors.is_empty());
    assert_eq!(
        serde_json::to_value(&report).unwrap()["assurance"]["creator_identity"],
        "not_verified"
    );
}

#[test]
fn forced_zip64_entries_verify() {
    let temp = TempDir::new().unwrap();
    let source = create_valid(temp.path());
    let zip64 = temp.path().join("zip64.aigcproof");
    rewrite_zip_with_options(
        &source,
        &zip64,
        SimpleFileOptions::default().large_file(true),
    );
    let report = verify_package(&zip64, &VerificationLimits::default(), NOW.to_owned());
    assert_eq!(
        report.status,
        VerificationStatus::Valid,
        "{:?}",
        report.errors
    );
}

#[test]
fn seal_refuses_to_overwrite_existing_output() {
    let temp = TempDir::new().unwrap();
    let workspace = temp.path().join("workspace");
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: None,
        created_at: NOW.to_owned(),
    })
    .unwrap();
    let source = temp.path().join("asset.txt");
    fs::write(&source, b"asset").unwrap();
    add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source,
        role: AssetRole::Input,
        asset_id: ASSET_ID.to_owned(),
        media_type: "text/plain".to_owned(),
    })
    .unwrap();
    let output = temp.path().join("exists.aigcproof");
    fs::write(&output, b"keep").unwrap();
    let error = seal_workspace(SealOptions {
        workspace,
        output: output.clone(),
        proof_id: PROOF_ID.to_owned(),
        created_at: NOW.to_owned(),
    })
    .unwrap_err();
    assert_eq!(error.code, "OUTPUT_ALREADY_EXISTS");
    assert_eq!(fs::read(output).unwrap(), b"keep");
}

#[cfg(unix)]
#[test]
fn workspace_asset_directory_symlink_is_rejected() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let workspace = temp.path().join("workspace");
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: None,
        created_at: NOW.to_owned(),
    })
    .unwrap();
    let source = temp.path().join("asset.txt");
    fs::write(&source, b"asset").unwrap();
    add_asset(AddAssetOptions {
        workspace: workspace.clone(),
        source,
        role: AssetRole::Input,
        asset_id: ASSET_ID.to_owned(),
        media_type: "text/plain".to_owned(),
    })
    .unwrap();
    let input_dir = workspace.join("assets/input");
    let moved_dir = temp.path().join("moved-input");
    fs::rename(&input_dir, &moved_dir).unwrap();
    symlink(&moved_dir, &input_dir).unwrap();
    let error = seal_workspace(SealOptions {
        workspace,
        output: temp.path().join("should-not-exist.aigcproof"),
        proof_id: PROOF_ID.to_owned(),
        created_at: NOW.to_owned(),
    })
    .unwrap_err();
    assert_eq!(error.code, "INVALID_ASSET_DIRECTORY");
}

#[cfg(unix)]
#[test]
fn source_asset_symlink_is_rejected() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let workspace = temp.path().join("workspace");
    init_workspace(InitWorkspaceOptions {
        path: workspace.clone(),
        project_name: None,
        created_at: NOW.to_owned(),
    })
    .unwrap();
    let target = temp.path().join("target.txt");
    let link = temp.path().join("link.txt");
    fs::write(&target, b"asset").unwrap();
    symlink(&target, &link).unwrap();
    let error = add_asset(AddAssetOptions {
        workspace,
        source: link,
        role: AssetRole::Input,
        asset_id: ASSET_ID.to_owned(),
        media_type: "text/plain".to_owned(),
    })
    .unwrap_err();
    assert_eq!(error.code, "ASSET_SYMBOLIC_LINK_REJECTED");
}

#[test]
fn asset_tampering_is_rejected_with_stable_code() {
    let temp = TempDir::new().unwrap();
    let source = create_valid(temp.path());
    let tampered = temp.path().join("tampered.aigcproof");
    rewrite_zip(&source, &tampered, |name, bytes| {
        if name.starts_with("assets/") {
            b"tampered".to_vec()
        } else {
            bytes
        }
    });
    assert_report_code(&tampered, "ASSET_HASH_MISMATCH");
}

#[test]
fn manifest_event_and_chain_tampering_are_rejected() {
    let temp = TempDir::new().unwrap();
    let source = create_valid(temp.path());
    for (filename, mutation, expected) in [
        (
            "manifest.aigcproof",
            "manifest-root",
            "EVENT_ROOT_HASH_MISMATCH",
        ),
        ("payload.aigcproof", "event-payload", "EVENT_HASH_MISMATCH"),
        (
            "previous.aigcproof",
            "event-previous",
            "EVENT_PREVIOUS_HASH_MISMATCH",
        ),
        ("delete.aigcproof", "event-delete", "EVENT_COUNT_MISMATCH"),
    ] {
        let destination = temp.path().join(filename);
        rewrite_zip(&source, &destination, |name, bytes| {
            mutate_json_entry(name, bytes, mutation)
        });
        assert_report_code(&destination, expected);
    }
    let missing_events = temp.path().join("events-missing.aigcproof");
    rewrite_zip_filter(&source, &missing_events, |name, bytes| {
        if name == "events.json" {
            None
        } else {
            Some(bytes)
        }
    });
    assert_report_code(&missing_events, "EVENTS_MISSING");
}

#[test]
fn traversal_absolute_drive_unc_and_backslash_entries_are_rejected() {
    let temp = TempDir::new().unwrap();
    for (index, name) in [
        "../evil",
        "/absolute/path",
        r"C:\evil",
        r"\\server\share",
        r"a\b",
    ]
    .iter()
    .enumerate()
    {
        let package = temp.path().join(format!("unsafe-{index}.aigcproof"));
        write_simple_zip(&package, &[(name, b"bad")]);
        assert_report_code(&package, "ZIP_ENTRY_PATH_UNSAFE");
    }
}

#[test]
fn duplicate_manifest_and_case_conflicts_are_rejected() {
    let temp = TempDir::new().unwrap();
    let duplicate = temp.path().join("duplicate.aigcproof");
    write_simple_zip(
        &duplicate,
        &[("manifest.json", b"{}"), ("Manifest.json", b"{}")],
    );
    replace_archive_name(&duplicate, b"Manifest.json", b"manifest.json");
    assert_report_code(&duplicate, "ZIP_ENTRY_DUPLICATE");

    let conflict = temp.path().join("case.aigcproof");
    write_simple_zip(
        &conflict,
        &[("manifest.json", b"{}"), ("Manifest.json", b"{}")],
    );
    assert_report_code(&conflict, "ZIP_ENTRY_CASE_CONFLICT");
}

#[test]
fn symbolic_links_and_missing_manifest_are_rejected() {
    let temp = TempDir::new().unwrap();
    let symlink = temp.path().join("symlink.aigcproof");
    let file = File::create(&symlink).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    writer
        .add_symlink("assets/link", "target", SimpleFileOptions::default())
        .unwrap();
    writer.finish().unwrap();
    assert_report_code(&symlink, "ZIP_ENTRY_SYMBOLIC_LINK");

    let missing = temp.path().join("missing.aigcproof");
    write_simple_zip(&missing, &[("events.json", b"[]")]);
    assert_report_code(&missing, "MANIFEST_MISSING");
}

#[test]
fn unix_special_file_metadata_is_rejected() {
    let temp = TempDir::new().unwrap();
    let special = temp.path().join("fifo.aigcproof");
    write_simple_zip(&special, &[("manifest.json", b"{}")]);
    set_first_entry_unix_mode(&special, 0o010644);
    assert_report_code(&special, "ZIP_ENTRY_NOT_REGULAR_FILE");
}

#[test]
fn all_archive_limits_are_enforced() {
    let temp = TempDir::new().unwrap();
    let package = temp.path().join("limits.aigcproof");
    write_simple_zip(
        &package,
        &[
            ("manifest.json", &[b'0'; 4096]),
            ("events.json", &[b'0'; 4096]),
        ],
    );

    let limits = VerificationLimits {
        max_entries: 1,
        ..VerificationLimits::default()
    };
    assert_report_code_with_limits(&package, "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED", &limits);

    let limits = VerificationLimits {
        max_package_bytes: 1,
        ..VerificationLimits::default()
    };
    assert_report_code_with_limits(&package, "PACKAGE_SIZE_LIMIT_EXCEEDED", &limits);
    assert_eq!(
        inspect_package(&package, &limits).unwrap_err().code,
        "PACKAGE_SIZE_LIMIT_EXCEEDED"
    );

    let limits = VerificationLimits {
        max_manifest_bytes: 8,
        ..VerificationLimits::default()
    };
    assert_report_code_with_limits(&package, "MANIFEST_LIMIT_EXCEEDED", &limits);

    let limits = VerificationLimits {
        max_single_entry_bytes: 8,
        ..VerificationLimits::default()
    };
    assert_report_code_with_limits(&package, "ZIP_SINGLE_ENTRY_LIMIT_EXCEEDED", &limits);

    let limits = VerificationLimits {
        max_total_uncompressed_bytes: 8,
        ..VerificationLimits::default()
    };
    assert_report_code_with_limits(&package, "ZIP_TOTAL_SIZE_LIMIT_EXCEEDED", &limits);

    let bomb = temp.path().join("ratio.aigcproof");
    write_deflated_zip(&bomb, &[("manifest.json", &[b'0'; 4096])]);
    let limits = VerificationLimits {
        max_compression_ratio: 1,
        ..VerificationLimits::default()
    };
    assert_report_code_with_limits(&bomb, "ZIP_COMPRESSION_RATIO_LIMIT_EXCEEDED", &limits);

    let valid = create_valid(temp.path());
    let limits = VerificationLimits {
        max_event_bytes: 1,
        ..VerificationLimits::default()
    };
    assert_report_code_with_limits(&valid, "EVENT_JSON_LIMIT_EXCEEDED", &limits);
}

#[test]
fn malformed_json_zip_spec_and_missing_asset_are_rejected() {
    let temp = TempDir::new().unwrap();
    let corrupt = temp.path().join("corrupt.aigcproof");
    fs::write(&corrupt, b"not a zip").unwrap();
    assert_report_code(&corrupt, "MALFORMED_ZIP");

    let source = create_valid(temp.path());
    for (filename, mutation, expected) in [
        ("json.aigcproof", "manifest-json", "MANIFEST_JSON_MALFORMED"),
        (
            "spec.aigcproof",
            "manifest-spec",
            "UNSUPPORTED_SPEC_VERSION",
        ),
        (
            "missing-asset.aigcproof",
            "manifest-missing-asset",
            "ASSET_MISSING",
        ),
        (
            "proof-id.aigcproof",
            "manifest-proof-id",
            "INVALID_PROOF_ID",
        ),
    ] {
        let destination = temp.path().join(filename);
        rewrite_zip(&source, &destination, |name, bytes| {
            mutate_json_entry(name, bytes, mutation)
        });
        assert_report_code(&destination, expected);
        let report = verify_package(&destination, &VerificationLimits::default(), NOW.to_owned());
        validate_verification_result_schema(&serde_json::to_value(report).unwrap()).unwrap();
    }
}

fn mutate_json_entry(name: &str, bytes: Vec<u8>, mutation: &str) -> Vec<u8> {
    match (name, mutation) {
        ("manifest.json", "manifest-json") => b"{".to_vec(),
        ("manifest.json", "manifest-root") => mutate_value(bytes, |value| {
            value["event_chain"]["root_hash"] = json!("0".repeat(64))
        }),
        ("manifest.json", "manifest-spec") => {
            mutate_value(bytes, |value| value["spec_version"] = json!("9.9.9"))
        }
        ("manifest.json", "manifest-missing-asset") => mutate_value(bytes, |value| {
            value["assets"][0]["package_path"] = json!("assets/input/missing.txt")
        }),
        ("manifest.json", "manifest-proof-id") => {
            mutate_value(bytes, |value| value["proof_id"] = json!("not-a-proof-id"))
        }
        ("events.json", "event-payload") => mutate_value(bytes, |value| {
            value[0]["payload"] = json!({"changed": true})
        }),
        ("events.json", "event-previous") => mutate_value(bytes, |value| {
            value[0]["previous_event_hash"] = json!("0".repeat(64))
        }),
        ("events.json", "event-delete") => canonical_json(&Vec::<Value>::new()).unwrap(),
        _ => bytes,
    }
}

fn rewrite_zip_with_options(source: &Path, destination: &Path, options: SimpleFileOptions) {
    let input = File::open(source).unwrap();
    let mut archive = zip::ZipArchive::new(input).unwrap();
    let output = File::create(destination).unwrap();
    let mut writer = zip::ZipWriter::new(output);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        writer.start_file(name, options).unwrap();
        writer.write_all(&bytes).unwrap();
    }
    writer.finish().unwrap();
}

fn set_first_entry_unix_mode(path: &Path, mode: u32) {
    const CENTRAL_HEADER: &[u8] = b"PK\x01\x02";
    let mut bytes = fs::read(path).unwrap();
    let offset = bytes
        .windows(CENTRAL_HEADER.len())
        .position(|window| window == CENTRAL_HEADER)
        .unwrap();
    bytes[offset + 5] = 3;
    bytes[offset + 38..offset + 42].copy_from_slice(&(mode << 16).to_le_bytes());
    fs::write(path, bytes).unwrap();
}

fn replace_archive_name(path: &Path, from: &[u8], to: &[u8]) {
    assert_eq!(from.len(), to.len());
    let mut bytes = fs::read(path).unwrap();
    let mut replacements = 0;
    for offset in 0..=bytes.len() - from.len() {
        if &bytes[offset..offset + from.len()] == from {
            bytes[offset..offset + to.len()].copy_from_slice(to);
            replacements += 1;
        }
    }
    assert_eq!(replacements, 2, "expected local and central names");
    fs::write(path, bytes).unwrap();
}

fn mutate_value(bytes: Vec<u8>, mutate: impl FnOnce(&mut Value)) -> Vec<u8> {
    let mut value: Value = serde_json::from_slice(&bytes).unwrap();
    mutate(&mut value);
    canonical_json(&value).unwrap()
}

fn rewrite_zip(source: &Path, destination: &Path, mutate: impl Fn(&str, Vec<u8>) -> Vec<u8>) {
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

fn rewrite_zip_filter(
    source: &Path,
    destination: &Path,
    mutate: impl Fn(&str, Vec<u8>) -> Option<Vec<u8>>,
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
        let Some(bytes) = mutate(&name, bytes) else {
            continue;
        };
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

fn write_simple_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    for (name, bytes) in entries {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
}

fn write_deflated_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    for (name, bytes) in entries {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
}

fn assert_report_code(path: &Path, code: &str) {
    assert_report_code_with_limits(path, code, &VerificationLimits::default());
}

fn assert_report_code_with_limits(path: &Path, code: &str, limits: &VerificationLimits) {
    let report = verify_package(path, limits, NOW.to_owned());
    assert_ne!(report.status, VerificationStatus::Valid);
    assert!(
        report.errors.iter().any(|error| error.code == code),
        "missing {code}: {:?}",
        report.errors
    );
    validate_verification_result_schema(&serde_json::to_value(report).unwrap()).unwrap();
}

#[test]
fn invalid_verification_timestamp_still_produces_a_schema_valid_error_report() {
    let temp = TempDir::new().unwrap();
    let package = create_valid(temp.path());
    let report = verify_package(
        &package,
        &VerificationLimits::default(),
        "invalid".to_owned(),
    );
    assert_eq!(report.status, VerificationStatus::Error);
    assert_eq!(report.verified_at, "1970-01-01T00:00:00Z");
    validate_verification_result_schema(&serde_json::to_value(report).unwrap()).unwrap();
}
