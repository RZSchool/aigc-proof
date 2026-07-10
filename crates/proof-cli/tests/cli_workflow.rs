use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;
use tempfile::TempDir;

#[test]
fn full_cli_workflow_runs_real_binary() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("input.txt"), b"input").unwrap();
    fs::write(temp.path().join("output.txt"), b"output").unwrap();
    fs::write(
        temp.path().join("generation-event.json"),
        br#"{"model":"demo-model","operation":"text-transformation","note":"AIGC-Proof 0.2 CLI verification demo"}"#,
    )
    .unwrap();

    success(temp.path(), &["init", "demo-workspace", "--project-name", "AIGC-Proof 0.2 demo"]);
    success(temp.path(), &["add", "demo-workspace", "input.txt", "--role", "input"]);
    success(temp.path(), &["add", "demo-workspace", "output.txt", "--role", "output"]);
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
        &["seal", "demo-workspace", "--output", "demo.aigcproof"],
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
    let inspect = success(temp.path(), &["inspect", "demo.aigcproof"]);
    assert!(String::from_utf8_lossy(&inspect.stdout).contains("integrity not verified"));
    let inspect_json = success(temp.path(), &["inspect", "demo.aigcproof", "--json"]);
    let inspection: Value = serde_json::from_slice(&inspect_json.stdout).unwrap();
    assert_eq!(inspection["verification_performed"], false);
}

fn success(directory: &Path, args: &[&str]) -> Output {
    let output = Command::new(env!("CARGO_BIN_EXE_aigc-proof"))
        .current_dir(directory)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{args:?} failed\nstdout={}\nstderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}
