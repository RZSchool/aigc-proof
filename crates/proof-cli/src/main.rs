use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::str::FromStr;

use clap::{Parser, Subcommand};
use proof_core::{
    AddAssetOptions, CoreError, InitWorkspaceOptions, RecordEventOptions, SealOptions,
    VerificationLimits, add_asset, current_timestamp, init_workspace, inspect_package,
    media_type_for_path, record_event, seal_workspace, verify_package,
};
use proof_schema::{
    AssetRole, VerificationStatus, parse_json_strict, validate_verification_result_schema,
};
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(
    name = "aigc-proof",
    version,
    about = "Offline AIGC-Proof 0.2 internal-integrity workflow",
    long_about = "Creates and verifies unsigned AIGC-Proof 0.2 packages. Creator identity is not verified; digital signature and trusted timestamp are not present; originality is not evaluated."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Create a new local proof workspace without overwriting existing data.
    Init {
        workspace: PathBuf,
        #[arg(long)]
        project_name: Option<String>,
    },
    /// Copy and hash a regular file into a proof workspace.
    Add {
        workspace: PathBuf,
        file: PathBuf,
        #[arg(long)]
        role: String,
    },
    /// Append a canonical, hash-linked creation event.
    Record {
        workspace: PathBuf,
        #[arg(long)]
        event_type: String,
        #[arg(long)]
        payload_file: PathBuf,
    },
    /// Seal a workspace into a new .aigcproof package.
    Seal {
        workspace: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    /// Verify package structure and internal integrity offline.
    Verify {
        package: PathBuf,
        #[arg(long = "json", value_name = "FILE")]
        json_output: Option<PathBuf>,
    },
    /// Read package metadata without claiming that integrity was verified.
    Inspect {
        package: PathBuf,
        #[arg(long)]
        json: bool,
    },
}

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return ExitCode::from(2);
        }
    };
    match run(cli) {
        Ok(code) => code,
        Err(error) => {
            emit_error(&error);
            ExitCode::from(2)
        }
    }
}

fn run(cli: Cli) -> Result<ExitCode, CliError> {
    match cli.command {
        Command::Init {
            workspace,
            project_name,
        } => {
            let created_at = current_timestamp().map_err(CliError::from_core)?;
            let state = init_workspace(InitWorkspaceOptions {
                path: workspace.clone(),
                project_name,
                created_at,
            })
            .map_err(CliError::from_core)?;
            print_json(&json!({
                "status": "initialized",
                "workspace": workspace.display().to_string(),
                "project": state.project,
            }))?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Add {
            workspace,
            file,
            role,
        } => {
            let role = AssetRole::from_str(&role)
                .map_err(|message| CliError::new("INVALID_ASSET_ROLE", message))?;
            let media_type = media_type_for_path(&file).to_owned();
            let asset = add_asset(AddAssetOptions {
                workspace,
                source: file,
                role,
                asset_id: Uuid::new_v4().to_string(),
                media_type,
            })
            .map_err(CliError::from_core)?;
            print_json(&json!({"status": "added", "asset": asset}))?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Record {
            workspace,
            event_type,
            payload_file,
        } => {
            let payload = read_payload(&payload_file)?;
            let event = record_event(RecordEventOptions {
                workspace,
                event_id: Uuid::new_v4().to_string(),
                event_type,
                created_at: current_timestamp().map_err(CliError::from_core)?,
                payload,
            })
            .map_err(CliError::from_core)?;
            print_json(&json!({"status": "recorded", "event": event}))?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Seal { workspace, output } => {
            let result = seal_workspace(SealOptions {
                workspace,
                output,
                proof_id: Uuid::new_v4().urn().to_string(),
                created_at: current_timestamp().map_err(CliError::from_core)?,
            })
            .map_err(CliError::from_core)?;
            print_json(&json!({
                "status": "sealed",
                "package": result.path.display().to_string(),
                "proof_id": result.manifest.proof_id,
                "assurance": {
                    "internal_integrity": "self-checked",
                    "creator_identity": "not_verified",
                    "digital_signature": "not_present",
                    "trusted_time": "not_present",
                    "originality": "not_evaluated"
                }
            }))?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Verify {
            package,
            json_output,
        } => {
            let report = verify_package(
                &package,
                &VerificationLimits::default(),
                current_timestamp().map_err(CliError::from_core)?,
            );
            let value = serde_json::to_value(&report)
                .map_err(|error| CliError::new("REPORT_SERIALIZATION_FAILED", error.to_string()))?;
            validate_verification_result_schema(&value).map_err(|errors| {
                CliError::new("REPORT_SCHEMA_INVALID", errors.join("; "))
            })?;
            let bytes = serde_json::to_vec_pretty(&report)
                .map_err(|error| CliError::new("REPORT_SERIALIZATION_FAILED", error.to_string()))?;
            if let Some(path) = json_output {
                write_new_file(&path, &bytes)?;
            }
            println!("{}", String::from_utf8_lossy(&bytes));
            Ok(match report.status {
                VerificationStatus::Valid => ExitCode::SUCCESS,
                VerificationStatus::Invalid => ExitCode::from(1),
                VerificationStatus::Error => ExitCode::from(2),
            })
        }
        Command::Inspect {
            package,
            json: output_json,
        } => {
            let inspection =
                inspect_package(&package, &VerificationLimits::default()).map_err(CliError::from_core)?;
            if output_json {
                let value = serde_json::to_value(&inspection).map_err(|error| {
                    CliError::new("INSPECTION_SERIALIZATION_FAILED", error.to_string())
                })?;
                print_json(&value)?;
            } else {
                println!("AIGC-Proof package metadata (integrity not verified)");
                println!("Proof ID: {}", inspection.proof_id);
                println!("Specification: {}", inspection.spec_version);
                println!("Created at (untrusted): {}", inspection.created_at);
                println!("Assets: {}", inspection.assets.len());
                println!("Events: {}", inspection.event_chain.event_count);
                println!("Creator identity: not verified");
                println!("Digital signature: not present");
                println!("Trusted timestamp: not present");
                println!("Originality: not evaluated");
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}

struct CliError {
    code: String,
    path: Option<String>,
    message: String,
}

impl CliError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            path: None,
            message: message.into(),
        }
    }

    fn from_core(error: CoreError) -> Self {
        Self {
            code: error.code.to_owned(),
            path: error.path.map(|path| path.display().to_string()),
            message: error.message,
        }
    }
}

fn read_payload(path: &Path) -> Result<Value, CliError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| CliError {
        code: "PAYLOAD_METADATA_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CliError {
            code: "PAYLOAD_NOT_REGULAR_FILE".to_owned(),
            path: Some(path.display().to_string()),
            message: "Payload must be a regular JSON file, not a symbolic link.".to_owned(),
        });
    }
    if metadata.len() > 1024 * 1024 {
        return Err(CliError {
            code: "PAYLOAD_SIZE_LIMIT_EXCEEDED".to_owned(),
            path: Some(path.display().to_string()),
            message: "Payload JSON exceeds 1 MiB.".to_owned(),
        });
    }
    let bytes = fs::read(path).map_err(|error| CliError {
        code: "PAYLOAD_READ_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    let payload: Value = parse_json_strict(&bytes).map_err(|error| CliError {
        code: "PAYLOAD_JSON_MALFORMED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    if !payload.is_object() {
        return Err(CliError {
            code: "PAYLOAD_NOT_OBJECT".to_owned(),
            path: Some(path.display().to_string()),
            message: "Payload file must contain a JSON object.".to_owned(),
        });
    }
    Ok(payload)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), CliError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| CliError {
            code: "OUTPUT_ALREADY_EXISTS_OR_UNWRITABLE".to_owned(),
            path: Some(path.display().to_string()),
            message: error.to_string(),
        })?;
    file.write_all(bytes).map_err(|error| CliError {
        code: "OUTPUT_WRITE_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    file.sync_all().map_err(|error| CliError {
        code: "OUTPUT_SYNC_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })
}

fn print_json(value: &Value) -> Result<(), CliError> {
    let output = serde_json::to_string_pretty(value)
        .map_err(|error| CliError::new("JSON_SERIALIZATION_FAILED", error.to_string()))?;
    println!("{output}");
    Ok(())
}

fn emit_error(error: &CliError) {
    let value = json!({
        "status": "error",
        "code": error.code,
        "path": error.path,
        "message": error.message,
    });
    match serde_json::to_string(&value) {
        Ok(output) => eprintln!("{output}"),
        Err(serialization_error) => eprintln!(
            "ERROR: {} (error serialization also failed: {})",
            error.message, serialization_error
        ),
    }
}
