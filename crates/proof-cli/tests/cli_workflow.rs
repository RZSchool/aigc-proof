use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;
use tempfile::TempDir;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

#[test]
fn full_cli_workflow_accepts_crlf_json_and_cleans_temporary_files() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("input.txt"), b"input").unwrap();
    fs::write(temp.path().join("output.txt"), b"output").unwrap();
    fs::write(
        temp.path().join("generation-event.json"),
        b"{\r\n  \"model\": \"demo-model\",\r\n  \"operation\": \"text-transformation\",\r\n  \"note\": \"AIGC-Proof 0.2 CLI verification demo\"\r\n}\r\n",
    )
    .unwrap();

    success(
        temp.path(),
        &[
            "init",
            "demo-workspace",
            "--project-name",
            "AIGC-Proof 0.2 demo",
        ],
    );
    success(
        temp.path(),
        &["add", "demo-workspace", "input.txt", "--role", "input"],
    );
    success(
        temp.path(),
        &["add", "demo-workspace", "output.txt", "--role", "output"],
    );
    success(
        temp.path(),
        &[
            "record",
            "demo-workspace",
            "--event-type",
            "generation",
            "--payload-file",
            "generation-event.json",
        ],
    );
    success(
        temp.path(),
        &[
            "seal",
            "demo-workspace",
            "--output",
            "demo.aigcproof",
            "--legacy-unsigned-v02",
        ],
    );
    let verify = success(temp.path(), &["verify", "demo.aigcproof"]);
    let report: Value = serde_json::from_slice(&verify.stdout).unwrap();
    assert_eq!(report["status"], "valid");
    assert_eq!(report["assurance"]["internal_integrity"], "valid");
    assert_eq!(report["assurance"]["creator_identity"], "not_verified");
    assert_eq!(report["assurance"]["digital_signature"], "not_present");
    assert_eq!(report["assurance"]["trusted_time"], "not_present");
    assert_eq!(report["assurance"]["originality"], "not_evaluated");
    success(
        temp.path(),
        &[
            "verify",
            "demo.aigcproof",
            "--json",
            "verification-result.json",
        ],
    );
    let persisted: Value =
        serde_json::from_slice(&fs::read(temp.path().join("verification-result.json")).unwrap())
            .unwrap();
    assert_eq!(persisted["status"], "valid");
    let original_report = fs::read(temp.path().join("verification-result.json")).unwrap();
    let refused = run(
        temp.path(),
        &[
            "verify",
            "demo.aigcproof",
            "--json",
            "verification-result.json",
        ],
    );
    assert_eq!(refused.status.code(), Some(2));
    assert_eq!(
        fs::read(temp.path().join("verification-result.json")).unwrap(),
        original_report
    );
    let inspect = success(temp.path(), &["inspect", "demo.aigcproof"]);
    assert!(String::from_utf8_lossy(&inspect.stdout).contains("integrity not verified"));
    let inspect_json = success(temp.path(), &["inspect", "demo.aigcproof", "--json"]);
    let inspection: Value = serde_json::from_slice(&inspect_json.stdout).unwrap();
    assert_eq!(inspection["verification_performed"], false);
    assert_no_internal_temporary_files(temp.path());
}

#[test]
fn real_cli_rejects_tampering_and_malicious_zip() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("input.txt"), b"input").unwrap();
    fs::write(temp.path().join("event.json"), br#"{"model":"demo-model"}"#).unwrap();
    success(temp.path(), &["init", "workspace"]);
    success(
        temp.path(),
        &["add", "workspace", "input.txt", "--role", "input"],
    );
    success(
        temp.path(),
        &[
            "record",
            "workspace",
            "--event-type",
            "generation",
            "--payload-file",
            "event.json",
        ],
    );
    success(
        temp.path(),
        &[
            "seal",
            "workspace",
            "--output",
            "valid.aigcproof",
            "--legacy-unsigned-v02",
        ],
    );

    for (name, mutation, expected_code) in [
        ("asset.aigcproof", "asset", "ASSET_HASH_MISMATCH"),
        ("manifest.aigcproof", "manifest", "EVENT_ROOT_HASH_MISMATCH"),
        ("event.aigcproof", "event", "EVENT_HASH_MISMATCH"),
    ] {
        rewrite_package(
            &temp.path().join("valid.aigcproof"),
            &temp.path().join(name),
            mutation,
        );
        let output = run(temp.path(), &["verify", name]);
        assert_eq!(output.status.code(), Some(1), "{name}");
        assert_report_error(&output.stdout, expected_code);
    }

    let persisted = run(
        temp.path(),
        &["verify", "asset.aigcproof", "--json", "invalid-report.json"],
    );
    assert_eq!(persisted.status.code(), Some(1));
    let persisted_report: Value =
        serde_json::from_slice(&fs::read(temp.path().join("invalid-report.json")).unwrap())
            .unwrap();
    assert_eq!(persisted_report["status"], "invalid");

    let malicious = temp.path().join("malicious.aigcproof");
    let mut writer = zip::ZipWriter::new(File::create(&malicious).unwrap());
    writer
        .start_file("../escape", SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"bad").unwrap();
    writer.finish().unwrap();
    let output = run(temp.path(), &["verify", "malicious.aigcproof"]);
    assert_eq!(
        output.status.code(),
        Some(1),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_report_error(&output.stdout, "ZIP_ENTRY_PATH_UNSAFE");
}

#[test]
fn real_cli_inspects_and_records_a_digest_bound_c2pa_observation() {
    let Some(corpus) = std::env::var_os("AIGC_PROOF_C2PA_CORPUS_DIR") else {
        eprintln!("skipped: AIGC_PROOF_C2PA_CORPUS_DIR is not configured");
        return;
    };
    let corpus = std::path::PathBuf::from(corpus);
    let temp = TempDir::new().unwrap();
    fs::copy(
        corpus.join("embedded-v2.jpg"),
        temp.path().join("signed.jpg"),
    )
    .unwrap();
    fs::copy(
        corpus.join("trust-profile.json"),
        temp.path().join("c2pa-trust.json"),
    )
    .unwrap();
    fs::copy(
        corpus.join("remote-reference.png"),
        temp.path().join("remote.png"),
    )
    .unwrap();
    let profile = success(temp.path(), &["c2pa", "profile", "c2pa-trust.json"]);
    let summary: Value = serde_json::from_slice(&profile.stdout).unwrap();
    assert_eq!(summary["profile"], "aigc-proof.c2pa-trust-profile.v1");
    let trustless = success(temp.path(), &["c2pa", "inspect", "--asset", "signed.jpg"]);
    let trustless: Value = serde_json::from_slice(&trustless.stdout).unwrap();
    assert_eq!(trustless["validation_state"], "valid_untrusted");
    assert_eq!(trustless["signer_trust"], "not_evaluated");
    assert_eq!(trustless["timestamp_trust"], "not_evaluated");
    assert!(trustless.get("signer_trust_snapshot_sha256").is_none());
    assert!(trustless.get("timestamp_trust_snapshot_sha256").is_none());
    let inspection = success(
        temp.path(),
        &[
            "c2pa",
            "inspect",
            "--asset",
            "signed.jpg",
            "--trust-profile",
            "c2pa-trust.json",
        ],
    );
    let inspection: Value = serde_json::from_slice(&inspection.stdout).unwrap();
    assert_eq!(inspection["claim_version"], 2);
    assert_eq!(inspection["source_mode"], "embedded");
    assert_eq!(inspection["validation_state"], "trusted");

    success(temp.path(), &["init", "workspace"]);
    success(
        temp.path(),
        &["add", "workspace", "signed.jpg", "--role", "output"],
    );
    let workspace: Value = serde_json::from_slice(
        &fs::read(temp.path().join("workspace/proof-workspace.json")).unwrap(),
    )
    .unwrap();
    let asset_id = workspace["assets"][0]["asset_id"].as_str().unwrap();
    success(
        temp.path(),
        &[
            "c2pa",
            "observe",
            "--workspace",
            "workspace",
            "--asset-id",
            asset_id,
            "--trust-profile",
            "c2pa-trust.json",
        ],
    );
    let events: Value = serde_json::from_slice(
        &fs::read(temp.path().join("workspace/events/events.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(events[0]["event_type"], "c2pa_observation");
    assert_eq!(
        events[0]["payload"]["asset_sha256"],
        workspace["assets"][0]["sha256"]
    );

    let remote = run(
        temp.path(),
        &[
            "c2pa",
            "inspect",
            "--asset",
            "remote.png",
            "--trust-profile",
            "c2pa-trust.json",
        ],
    );
    assert_eq!(remote.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&remote.stderr).contains("C2PA_MANIFEST_NOT_FOUND"));
}

fn rewrite_package(source: &Path, destination: &Path, mutation: &str) {
    let mut archive = zip::ZipArchive::new(File::open(source).unwrap()).unwrap();
    let mut writer = zip::ZipWriter::new(File::create(destination).unwrap());
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let name = entry.name().to_owned();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        let bytes = match (name.as_str(), mutation) {
            (path, "asset") if path.starts_with("assets/") => b"tampered".to_vec(),
            ("manifest.json", "manifest") => mutate_json(bytes, |value| {
                value["event_chain"]["root_hash"] = Value::String("0".repeat(64));
            }),
            ("events.json", "event") => mutate_json(bytes, |value| {
                value[0]["payload"] = serde_json::json!({"changed": true});
            }),
            _ => bytes,
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

fn mutate_json(bytes: Vec<u8>, mutation: impl FnOnce(&mut Value)) -> Vec<u8> {
    let mut value: Value = serde_json::from_slice(&bytes).unwrap();
    mutation(&mut value);
    proof_core::canonical_json(&value).unwrap()
}

fn assert_report_error(bytes: &[u8], expected_code: &str) {
    let report: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(report["status"], "invalid");
    assert!(
        report["errors"]
            .as_array()
            .unwrap()
            .iter()
            .any(|error| error["code"] == expected_code),
        "missing {expected_code}: {report}"
    );
}

fn success(directory: &Path, args: &[&str]) -> Output {
    let output = run(directory, args);
    assert!(
        output.status.success(),
        "{args:?} failed\nstdout={}\nstderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn run(directory: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_aigc-proof"))
        .current_dir(directory)
        .args(args)
        .output()
        .unwrap()
}

fn assert_no_internal_temporary_files(directory: &Path) {
    for entry in fs::read_dir(directory).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        let name = entry.file_name();
        assert!(
            !name.to_string_lossy().starts_with(".aigc-proof-"),
            "temporary file was not cleaned up: {}",
            path.display()
        );
        if path.is_dir() {
            assert_no_internal_temporary_files(&path);
        }
    }
}
