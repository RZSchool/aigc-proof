use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::str::FromStr;

use base64::Engine as _;
use clap::{Parser, Subcommand};
use proof_core::{
    AddAssetOptions, C2paInspectOptions, CoreError, CreateC2paObservationOptions,
    InitWorkspaceOptions, OfficialIdentityVerifyOptions, ParsedC2paTrustProfile, ParsedTsaProfile,
    RecordEventOptions, SealOptions, SignerService, VerificationLimits, add_asset,
    attach_timestamp_response, create_c2pa_observation, current_timestamp, init_workspace,
    inspect_c2pa, inspect_package, media_type_for_path, parse_c2pa_trust_profile,
    parse_tsa_profile, prepare_timestamp_request, record_event, seal_signed_workspace,
    seal_signed_workspace_with_timestamp, seal_workspace, tsa_profile_summary,
    verify_official_identity, verify_package_with_signer, verify_package_with_signer_and_profile,
};
use proof_schema::{
    AssetRole, VerificationStatus, parse_json_strict, validate_verification_result_schema,
};
use serde_json::{Value, json};
use tempfile::Builder;
use uuid::Uuid;

#[derive(Debug, Parser)]
#[command(
    name = "aigc-proof",
    version,
    about = "Offline AIGC-Proof interoperable assurance workflow",
    long_about = "Creates protocol 1.0 packages; verifies 0.2 through 1.0; and evaluates creator signatures, RFC 3161, C2PA 2.2, and official identity as separate assurance layers using explicit portable trust snapshots."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Manage the current user's OS-protected local creator key.
    Key {
        #[command(subcommand)]
        command: KeyCommand,
    },
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
        /// Confirm that this operation will create a creator signature.
        #[arg(long)]
        confirm_signature: bool,
        /// Produce a legacy unsigned protocol 0.2 package for compatibility testing.
        #[arg(long, conflicts_with = "confirm_signature")]
        legacy_unsigned_v02: bool,
        /// Explicit portable TSA trust snapshot used to predeclare a protocol 0.4 request.
        #[arg(
            long,
            value_name = "FILE",
            requires = "confirm_signature",
            conflicts_with = "legacy_unsigned_v02"
        )]
        tsa_profile: Option<PathBuf>,
        /// Requested RFC 3161 policy OID, or the explicit `any` marker.
        #[arg(long, default_value = "any", requires = "tsa_profile")]
        timestamp_policy: String,
    },
    /// Verify package structure and internal integrity offline.
    Verify {
        package: PathBuf,
        #[arg(long = "json", value_name = "FILE")]
        json_output: Option<PathBuf>,
        /// Explicit portable TSA trust snapshot for offline timestamp verification.
        #[arg(long, value_name = "FILE")]
        tsa_profile: Option<PathBuf>,
    },
    /// Read package metadata without claiming that integrity was verified.
    Inspect {
        package: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Prepare or attach an RFC 3161 response without performing network access.
    Timestamp {
        #[command(subcommand)]
        command: TimestampCommand,
    },
    /// Inspect C2PA 2.2 image provenance offline or record a digest-bound observation.
    C2pa {
        #[command(subcommand)]
        command: C2paCommand,
    },
    /// Verify an official identity attestation and signed status snapshot entirely offline.
    OfficialIdentity {
        #[arg(long, value_name = "FILE")]
        attestation: PathBuf,
        #[arg(long, value_name = "FILE")]
        issuer_trust: PathBuf,
        #[arg(long, value_name = "FILE")]
        status: Option<PathBuf>,
        #[arg(long)]
        creator_key_fingerprint: String,
        #[arg(long)]
        purpose: String,
        /// Explicit Unix verification time; never inferred from the attestation.
        #[arg(long)]
        at: i64,
        #[arg(long, default_value_t = 1)]
        minimum_trust_sequence: i64,
        #[arg(long, default_value_t = 1)]
        minimum_status_sequence: i64,
        #[arg(long)]
        expected_previous_status_digest: Option<String>,
        #[arg(long, default_value_t = 604800)]
        max_status_age_seconds: i64,
    },
}

#[derive(Debug, Subcommand)]
enum C2paCommand {
    /// Validate and summarize an explicit portable C2PA trust profile.
    Profile {
        #[arg(value_name = "FILE")]
        trust_profile: PathBuf,
    },
    /// Inspect an embedded manifest or an explicitly selected local .c2pa sidecar.
    Inspect {
        #[arg(long, value_name = "FILE")]
        asset: PathBuf,
        #[arg(long, value_name = "FILE")]
        sidecar: Option<PathBuf>,
        #[arg(long, value_name = "FILE")]
        trust_profile: PathBuf,
    },
    /// Inspect and append a C2PA observation for an already ingested workspace asset.
    Observe {
        #[arg(long, value_name = "DIR")]
        workspace: PathBuf,
        #[arg(long)]
        asset_id: String,
        #[arg(long, value_name = "FILE")]
        sidecar: Option<PathBuf>,
        #[arg(long, value_name = "FILE")]
        trust_profile: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum TimestampCommand {
    /// Build the exact DER request and print the endpoint disclosure as JSON.
    Request {
        package: PathBuf,
        #[arg(long, value_name = "FILE")]
        tsa_profile: PathBuf,
        #[arg(long, value_name = "FILE")]
        output: PathBuf,
    },
    /// Verify a received DER response and attach it to a new no-clobber package.
    Attach {
        package: PathBuf,
        #[arg(long, value_name = "FILE")]
        response: PathBuf,
        #[arg(long, value_name = "FILE")]
        tsa_profile: PathBuf,
        #[arg(long, value_name = "FILE")]
        output: PathBuf,
    },
    /// Validate and summarize an explicit portable TSA trust snapshot.
    Profile {
        #[arg(value_name = "FILE")]
        tsa_profile: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum KeyCommand {
    /// Report public local-key metadata without exposing private bytes.
    Status,
    /// Create the first local creator key.
    Create {
        #[arg(long)]
        display_label: String,
    },
    /// Replace the current local key after explicit confirmation.
    Rotate {
        #[arg(long)]
        display_label: String,
        #[arg(long)]
        confirm: bool,
    },
    /// Disable the current key for new signing after explicit confirmation.
    Disable {
        #[arg(long)]
        confirm: bool,
    },
    /// Export only the deterministic public COSE_Key bytes.
    ExportPublic {
        #[arg(long)]
        output: PathBuf,
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
        Command::Key { command } => {
            let signer = SignerService::production();
            match command {
                KeyCommand::Status => {
                    print_json(&serde_json::to_value(signer.status()).map_err(|error| {
                        CliError::new("KEY_STATUS_SERIALIZATION_FAILED", error.to_string())
                    })?)?
                }
                KeyCommand::Create { display_label } => {
                    let status = signer.create(&display_label).map_err(CliError::from_core)?;
                    print_json(&json!({"status": "created", "signer": status}))?;
                }
                KeyCommand::Rotate {
                    display_label,
                    confirm,
                } => {
                    require_confirmation(confirm, "KEY_ROTATION_NOT_CONFIRMED")?;
                    let status = signer.rotate(&display_label).map_err(CliError::from_core)?;
                    print_json(&json!({"status": "rotated", "signer": status}))?;
                }
                KeyCommand::Disable { confirm } => {
                    require_confirmation(confirm, "KEY_DISABLE_NOT_CONFIRMED")?;
                    let status = signer.disable().map_err(CliError::from_core)?;
                    print_json(&json!({"status": "disabled", "signer": status}))?;
                }
                KeyCommand::ExportPublic { output } => {
                    let public_key = signer.export_public_key().map_err(CliError::from_core)?;
                    write_new_file(&output, &public_key)?;
                    print_json(&json!({
                        "status": "exported",
                        "public_key": output.display().to_string()
                    }))?;
                }
            }
            Ok(ExitCode::SUCCESS)
        }
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
        Command::Seal {
            workspace,
            output,
            confirm_signature,
            legacy_unsigned_v02,
            tsa_profile,
            timestamp_policy,
        } => {
            if !legacy_unsigned_v02 {
                require_confirmation(confirm_signature, "SIGNATURE_NOT_CONFIRMED")?;
            }
            let options = SealOptions {
                workspace,
                output,
                proof_id: Uuid::new_v4().urn().to_string(),
                created_at: current_timestamp().map_err(CliError::from_core)?,
            };
            let imported_profile = tsa_profile.as_deref().map(read_tsa_profile).transpose()?;
            let result = if legacy_unsigned_v02 {
                seal_workspace(options)
            } else if let Some(profile) = imported_profile.as_ref() {
                seal_signed_workspace_with_timestamp(
                    options,
                    &SignerService::production(),
                    profile,
                    &timestamp_policy,
                )
            } else {
                seal_signed_workspace(options, &SignerService::production())
            }
            .map_err(CliError::from_core)?;
            let signed = result.manifest.security.is_some();
            print_json(&json!({
                "status": "sealed",
                "package": result.path.display().to_string(),
                "proof_id": result.manifest.proof_id,
                "assurance": {
                    "internal_integrity": "self-checked",
                    "creator_identity": if signed { "self_asserted" } else { "not_verified" },
                    "digital_signature": if signed { "self_checked" } else { "not_present" },
                    "trusted_time": if imported_profile.is_some() { "planned_not_acquired" } else { "not_present" },
                    "originality": "not_evaluated"
                }
            }))?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Verify {
            package,
            json_output,
            tsa_profile,
        } => {
            let profile = tsa_profile.as_deref().map(read_tsa_profile).transpose()?;
            let now = current_timestamp().map_err(CliError::from_core)?;
            let signer = SignerService::production();
            let report = match profile.as_ref() {
                Some(profile) => verify_package_with_signer_and_profile(
                    &package,
                    &VerificationLimits::default(),
                    now,
                    &signer,
                    profile,
                ),
                None => verify_package_with_signer(
                    &package,
                    &VerificationLimits::default(),
                    now,
                    &signer,
                ),
            };
            let value = serde_json::to_value(&report)
                .map_err(|error| CliError::new("REPORT_SERIALIZATION_FAILED", error.to_string()))?;
            validate_verification_result_schema(&value)
                .map_err(|errors| CliError::new("REPORT_SCHEMA_INVALID", errors.join("; ")))?;
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
            let inspection = inspect_package(&package, &VerificationLimits::default())
                .map_err(CliError::from_core)?;
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
                if let Some(signature) = inspection.creator_signature {
                    println!("Creator label (self-asserted): {}", signature.display_label);
                    println!("Key fingerprint: {}", signature.key_fingerprint);
                    println!("Digital signature: present but not verified by inspect");
                } else {
                    println!("Creator identity: not verified");
                    println!("Digital signature: not present");
                }
                if let Some(timestamp) = inspection.trusted_timestamp {
                    println!("Trusted timestamp plan: {}", timestamp.timestamp_path);
                    println!("TSA profile SHA-256: {}", timestamp.tsa_profile_sha256);
                } else {
                    println!("Trusted timestamp: not present");
                }
                println!("Originality: not evaluated");
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Timestamp { command } => match command {
            TimestampCommand::Request {
                package,
                tsa_profile,
                output,
            } => {
                let profile = read_tsa_profile(&tsa_profile)?;
                let prepared = prepare_timestamp_request(
                    &package,
                    &profile,
                    &VerificationLimits::default(),
                    current_timestamp().map_err(CliError::from_core)?,
                )
                .map_err(CliError::from_core)?;
                let der = base64::engine::general_purpose::STANDARD
                    .decode(&prepared.disclosure.request_der_base64)
                    .map_err(|error| {
                        CliError::new("TIMESTAMP_REQUEST_DECODE_FAILED", error.to_string())
                    })?;
                write_new_file(&output, &der)?;
                print_json(&json!({
                    "status": "prepared",
                    "request": output.display().to_string(),
                    "timestamp_path": prepared.timestamp_path,
                    "disclosure": prepared.disclosure,
                }))?;
                Ok(ExitCode::SUCCESS)
            }
            TimestampCommand::Attach {
                package,
                response,
                tsa_profile,
                output,
            } => {
                let profile = read_tsa_profile(&tsa_profile)?;
                let response_der = read_bounded_file(&response, 1024 * 1024, "TIMESTAMP_RESPONSE")?;
                let attached = attach_timestamp_response(
                    &package,
                    &output,
                    &response_der,
                    &profile,
                    &VerificationLimits::default(),
                    current_timestamp().map_err(CliError::from_core)?,
                )
                .map_err(CliError::from_core)?;
                print_json(&json!({
                    "status": "attached",
                    "package": attached.path.display().to_string(),
                    "timestamp_path": attached.timestamp_path,
                    "trusted_time": attached.gen_time,
                }))?;
                Ok(ExitCode::SUCCESS)
            }
            TimestampCommand::Profile { tsa_profile } => {
                let profile = read_tsa_profile(&tsa_profile)?;
                print_json(
                    &serde_json::to_value(tsa_profile_summary(&profile)).map_err(|error| {
                        CliError::new("TSA_PROFILE_SERIALIZATION_FAILED", error.to_string())
                    })?,
                )?;
                Ok(ExitCode::SUCCESS)
            }
        },
        Command::C2pa { command } => match command {
            C2paCommand::Profile { trust_profile } => {
                let profile = read_c2pa_profile(&trust_profile)?;
                print_json(&json!({
                    "profile": profile.profile.profile,
                    "profile_sha256": profile.digest,
                    "signer_snapshot_sha256": profile.signer_snapshot_sha256,
                    "timestamp_snapshot_sha256": profile.timestamp_snapshot_sha256,
                    "signer_source": profile.profile.signer.source_label,
                    "timestamp_source": profile.profile.timestamp.source_label,
                }))?;
                Ok(ExitCode::SUCCESS)
            }
            C2paCommand::Inspect {
                asset,
                sidecar,
                trust_profile,
            } => {
                let profile = read_c2pa_profile(&trust_profile)?;
                let inspection = inspect_c2pa(C2paInspectOptions {
                    asset_path: asset,
                    sidecar_path: sidecar,
                    trust_profile: &profile,
                    observed_at: current_timestamp().map_err(CliError::from_core)?,
                })
                .map_err(CliError::from_core)?;
                print_json(&serde_json::to_value(inspection).map_err(|error| {
                    CliError::new("C2PA_INSPECTION_SERIALIZATION_FAILED", error.to_string())
                })?)?;
                Ok(ExitCode::SUCCESS)
            }
            C2paCommand::Observe {
                workspace,
                asset_id,
                sidecar,
                trust_profile,
            } => {
                let profile = read_c2pa_profile(&trust_profile)?;
                let now = current_timestamp().map_err(CliError::from_core)?;
                let event = create_c2pa_observation(CreateC2paObservationOptions {
                    workspace,
                    asset_id,
                    sidecar_path: sidecar,
                    trust_profile: &profile,
                    event_id: Uuid::new_v4().to_string(),
                    created_at: now,
                })
                .map_err(CliError::from_core)?;
                print_json(&json!({ "status": "recorded", "event": event }))?;
                Ok(ExitCode::SUCCESS)
            }
        },
        Command::OfficialIdentity {
            attestation,
            issuer_trust,
            status,
            creator_key_fingerprint,
            purpose,
            at,
            minimum_trust_sequence,
            minimum_status_sequence,
            expected_previous_status_digest,
            max_status_age_seconds,
        } => {
            let attestation = read_bounded_file(&attestation, 64 * 1024, "OFFICIAL_ATTESTATION")?;
            let trust = read_bounded_file(&issuer_trust, 64 * 1024, "OFFICIAL_ISSUER_TRUST")?;
            let status = status
                .as_deref()
                .map(|path| read_bounded_file(path, 64 * 1024, "OFFICIAL_STATUS"))
                .transpose()?;
            let report = verify_official_identity(OfficialIdentityVerifyOptions {
                attestation_cose: &attestation,
                issuer_trust_json: &trust,
                status_cose: status.as_deref(),
                expected_creator_key_fingerprint: &creator_key_fingerprint,
                expected_purpose: &purpose,
                verification_time: at,
                minimum_trust_sequence,
                minimum_status_sequence,
                expected_previous_status_digest: expected_previous_status_digest.as_deref(),
                max_status_age_seconds,
            });
            print_json(&serde_json::to_value(&report).map_err(|error| {
                CliError::new("OFFICIAL_REPORT_SERIALIZATION_FAILED", error.to_string())
            })?)?;
            Ok(
                if report.state == proof_schema::OfficialIdentityAssurance::ValidTrusted {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::from(1)
                },
            )
        }
    }
}

fn read_c2pa_profile(path: &Path) -> Result<ParsedC2paTrustProfile, CliError> {
    let bytes = read_bounded_file(path, 4 * 1024 * 1024, "C2PA_TRUST_PROFILE")?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|error| CliError::new("C2PA_TRUST_PROFILE_UTF8_INVALID", error.to_string()))?;
    parse_c2pa_trust_profile(text).map_err(CliError::from_core)
}

fn read_tsa_profile(path: &Path) -> Result<ParsedTsaProfile, CliError> {
    let bytes = read_bounded_file(path, 1024 * 1024, "TSA_PROFILE")?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|error| CliError::new("TSA_PROFILE_UTF8_INVALID", error.to_string()))?;
    parse_tsa_profile(text).map_err(CliError::from_core)
}

fn read_bounded_file(path: &Path, limit: u64, label: &str) -> Result<Vec<u8>, CliError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| CliError {
        code: format!("{label}_METADATA_FAILED"),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > limit {
        return Err(CliError {
            code: format!("{label}_FILE_INVALID"),
            path: Some(path.display().to_string()),
            message: format!("Input must be a regular file no larger than {limit} bytes."),
        });
    }
    let mut file = File::open(path).map_err(|error| CliError {
        code: format!("{label}_READ_FAILED"),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::take(&mut file, limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| CliError {
            code: format!("{label}_READ_FAILED"),
            path: Some(path.display().to_string()),
            message: error.to_string(),
        })?;
    if bytes.len() as u64 > limit {
        return Err(CliError {
            code: format!("{label}_SIZE_LIMIT_EXCEEDED"),
            path: Some(path.display().to_string()),
            message: format!("Input exceeds {limit} bytes."),
        });
    }
    Ok(bytes)
}

fn require_confirmation(confirmed: bool, code: &'static str) -> Result<(), CliError> {
    if confirmed {
        Ok(())
    } else {
        Err(CliError::new(
            code,
            "Explicit confirmation flag is required for this key or signing operation.",
        ))
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
    let mut file = File::open(path).map_err(|error| CliError {
        code: "PAYLOAD_READ_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    let opened_metadata = file.metadata().map_err(|error| CliError {
        code: "PAYLOAD_METADATA_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    if !opened_metadata.is_file() {
        return Err(CliError {
            code: "PAYLOAD_NOT_REGULAR_FILE".to_owned(),
            path: Some(path.display().to_string()),
            message: "Opened payload must be a regular file.".to_owned(),
        });
    }
    let mut bytes = Vec::with_capacity(opened_metadata.len().min(1024 * 1024) as usize);
    Read::take(&mut file, 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| CliError {
            code: "PAYLOAD_READ_FAILED".to_owned(),
            path: Some(path.display().to_string()),
            message: error.to_string(),
        })?;
    if bytes.len() > 1024 * 1024 {
        return Err(CliError {
            code: "PAYLOAD_SIZE_LIMIT_EXCEEDED".to_owned(),
            path: Some(path.display().to_string()),
            message: "Payload JSON exceeds 1 MiB.".to_owned(),
        });
    }
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
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent_metadata = fs::symlink_metadata(parent).map_err(|error| CliError {
        code: "OUTPUT_DIRECTORY_INVALID".to_owned(),
        path: Some(parent.display().to_string()),
        message: error.to_string(),
    })?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(CliError {
            code: "OUTPUT_DIRECTORY_INVALID".to_owned(),
            path: Some(parent.display().to_string()),
            message: "Output parent must be a real directory, not a symbolic link.".to_owned(),
        });
    }
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-report-")
        .tempfile_in(parent)
        .map_err(|error| CliError {
            code: "TEMPORARY_FILE_FAILED".to_owned(),
            path: Some(parent.display().to_string()),
            message: error.to_string(),
        })?;
    temporary.write_all(bytes).map_err(|error| CliError {
        code: "OUTPUT_WRITE_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    temporary.as_file().sync_all().map_err(|error| CliError {
        code: "OUTPUT_SYNC_FAILED".to_owned(),
        path: Some(path.display().to_string()),
        message: error.to_string(),
    })?;
    temporary
        .persist_noclobber(path)
        .map(|_| ())
        .map_err(|error| CliError {
            code: "OUTPUT_ALREADY_EXISTS_OR_UNWRITABLE".to_owned(),
            path: Some(path.display().to_string()),
            message: error.error.to_string(),
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
