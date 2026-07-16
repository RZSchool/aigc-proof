mod app_state;

use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use proof_core::{
    AddAssetOptions, C2paInspectOptions, CoreError, CreateC2paObservationOptions,
    ExportWorkspaceOutputOptions, InitWorkspaceOptions, OsSignerKeyStore, RecordEventOptions,
    SealOptions, SignerService, VerificationLimits, add_asset, attach_timestamp_response,
    create_c2pa_observation, current_timestamp, export_workspace_output, init_workspace,
    inspect_c2pa, inspect_package, load_workspace, match_image_to_package, media_type_for_path,
    parse_c2pa_trust_profile, parse_tsa_profile, prepare_timestamp_request, record_event,
    seal_signed_workspace, seal_signed_workspace_with_timestamp, tsa_profile_summary,
    verify_package_with_signer, verify_package_with_signer_and_profile,
};
use proof_schema::{AssetRole, parse_json_strict};
use rusqlite::Error as SqliteError;
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

pub const NATIVE_API_VERSION: &str = "1.6.0";
pub const NATIVE_ENGINE_VERSION: &str = "0.5.0";
pub const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["0.2.0", "0.3.0", "0.4.0", "0.5.0"];
pub const NATIVE_CAPABILITIES: &[&str] = &[
    "c2pa.image.inspect",
    "c2pa.observation.create",
    "c2pa.trust-profile.validate",
    "execution.phase-progress",
    "proof.asset.add",
    "proof.asset.export",
    "proof.asset.match",
    "proof.event.record",
    "proof.package.inspect",
    "proof.package.seal",
    "proof.package.timestamp.attach",
    "proof.package.timestamp.request",
    "proof.package.verify",
    "proof.signer.create",
    "proof.signer.disable",
    "proof.signer.rotate",
    "proof.signer.status",
    "proof.workspace.create",
    "proof.workspace.open",
    "trust.tsa-profile.validate",
];

#[derive(Debug, Clone, Serialize)]
#[napi(object)]
pub struct NativeExecutionFacts {
    pub napi_async_tasks: bool,
    pub utility_process_isolation: bool,
    pub progress_streaming: bool,
    pub safe_cancellation: bool,
}

#[derive(Debug, Clone, Serialize)]
#[napi(object)]
pub struct NativeApiInfo {
    pub api_version: String,
    pub engine_version: String,
    pub supported_protocol_versions: Vec<String>,
    pub capabilities: Vec<String>,
    pub execution: NativeExecutionFacts,
    pub limits: NativeRuntimeLimits,
}

#[derive(Debug, Clone, Serialize)]
#[napi(object)]
pub struct NativeRuntimeLimits {
    pub max_concurrent_jobs: u32,
    pub max_queued_jobs: u32,
    pub max_message_bytes: u32,
    pub max_progress_events_per_second: u32,
    pub operation_timeout_ms: u32,
    pub startup_timeout_ms: u32,
    pub shutdown_timeout_ms: u32,
}

#[napi]
pub fn get_api_info() -> NativeApiInfo {
    NativeApiInfo {
        api_version: NATIVE_API_VERSION.to_owned(),
        engine_version: NATIVE_ENGINE_VERSION.to_owned(),
        supported_protocol_versions: SUPPORTED_PROTOCOL_VERSIONS
            .iter()
            .map(|version| (*version).to_owned())
            .collect(),
        capabilities: NATIVE_CAPABILITIES
            .iter()
            .map(|capability| (*capability).to_owned())
            .collect(),
        execution: NativeExecutionFacts {
            napi_async_tasks: true,
            utility_process_isolation: true,
            progress_streaming: true,
            safe_cancellation: false,
        },
        limits: NativeRuntimeLimits {
            max_concurrent_jobs: 1,
            max_queued_jobs: 16,
            max_message_bytes: 1024 * 1024,
            max_progress_events_per_second: 10,
            operation_timeout_ms: 5 * 60 * 1000,
            startup_timeout_ms: 10 * 1000,
            shutdown_timeout_ms: 5 * 1000,
        },
    }
}

#[derive(Debug, Clone)]
enum Operation {
    InitializeWorkspace(InitializeWorkspaceRequest),
    LoadWorkspace(PathRequest),
    AddAsset(AddAssetRequest),
    ExportWorkspaceOutput(ExportWorkspaceOutputRequest),
    MatchImageToPackage(MatchImageToPackageRequest),
    RecordEvent(RecordEventRequest),
    SealPackage(SealPackageRequest),
    VerifyPackage(VerifyPackageRequest),
    InspectPackage(PathRequest),
    ValidateTsaProfile(TsaProfileRequest),
    PrepareTimestamp(PrepareTimestampRequest),
    AttachTimestamp(AttachTimestampRequest),
    ValidateC2paProfile(C2paProfileRequest),
    InspectC2pa(C2paInspectRequest),
    CreateC2paObservation(C2paObservationRequest),
    GetSignerStatus,
    CreateSigner(SignerLabelRequest),
    RotateSigner(SignerLabelRequest),
    DisableSigner,
    InitializeAppState(DatabaseRequest),
    GetAppState(DatabaseRequest),
    SetPreference(SetPreferenceRequest),
    RememberRecent(RememberRecentRequest),
    RebuildRecents(DatabaseRequest),
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct InitializeWorkspaceRequest {
    pub path: String,
    pub project_name: Option<String>,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct PathRequest {
    pub path: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct AddAssetRequest {
    pub workspace: String,
    pub source: String,
    pub role: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct ExportWorkspaceOutputRequest {
    pub workspace: String,
    pub asset_id: String,
    pub output: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct MatchImageToPackageRequest {
    pub package: String,
    pub image: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct RecordEventRequest {
    pub workspace: String,
    pub event_type: String,
    pub payload_json: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct SealPackageRequest {
    pub workspace: String,
    pub output: String,
    pub confirm_signature: bool,
    pub tsa_profile_json: Option<String>,
    pub timestamp_policy: Option<String>,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct VerifyPackageRequest {
    pub path: String,
    pub tsa_profile_json: Option<String>,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct TsaProfileRequest {
    pub profile_json: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct PrepareTimestampRequest {
    pub package: String,
    pub profile_json: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct AttachTimestampRequest {
    pub package: String,
    pub output: String,
    pub response_path: String,
    pub profile_json: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct C2paProfileRequest {
    pub profile_json: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct C2paInspectRequest {
    pub asset: String,
    pub sidecar: Option<String>,
    pub profile_json: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct C2paObservationRequest {
    pub workspace: String,
    pub asset_id: String,
    pub sidecar: Option<String>,
    pub profile_json: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct SignerLabelRequest {
    pub display_label: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct DatabaseRequest {
    pub database: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct SetPreferenceRequest {
    pub database: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct RememberRecentRequest {
    pub database: String,
    pub kind: String,
    pub path: String,
}

#[derive(Debug)]
pub struct BridgeTask {
    operation: Operation,
}

impl BridgeTask {
    fn new(operation: Operation) -> Self {
        Self { operation }
    }
}

impl Task for BridgeTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        Ok(run_operation(&self.operation))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn initialize_workspace(request: InitializeWorkspaceRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::InitializeWorkspace(request)))
}

#[napi]
pub fn load_workspace_summary(request: PathRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::LoadWorkspace(request)))
}

#[napi]
pub fn add_workspace_asset(request: AddAssetRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::AddAsset(request)))
}

#[napi]
pub fn export_workspace_output_asset(
    request: ExportWorkspaceOutputRequest,
) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::ExportWorkspaceOutput(request)))
}

#[napi]
pub fn match_image_to_proof_package(request: MatchImageToPackageRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::MatchImageToPackage(request)))
}

#[napi]
pub fn record_workspace_event(request: RecordEventRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::RecordEvent(request)))
}

#[napi]
pub fn seal_proof_package(request: SealPackageRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::SealPackage(request)))
}

#[napi]
pub fn verify_proof_package(request: VerifyPackageRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::VerifyPackage(request)))
}

#[napi]
pub fn inspect_proof_package(request: PathRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::InspectPackage(request)))
}

#[napi]
pub fn validate_tsa_profile(request: TsaProfileRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::ValidateTsaProfile(request)))
}

#[napi]
pub fn prepare_proof_timestamp(request: PrepareTimestampRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::PrepareTimestamp(request)))
}

#[napi]
pub fn attach_proof_timestamp(request: AttachTimestampRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::AttachTimestamp(request)))
}

#[napi(js_name = "validateC2paProfile")]
pub fn validate_c2pa_profile(request: C2paProfileRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::ValidateC2paProfile(request)))
}

#[napi(js_name = "inspectC2paImage")]
pub fn inspect_c2pa_image(request: C2paInspectRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::InspectC2pa(request)))
}

#[napi(js_name = "createWorkspaceC2paObservation")]
pub fn create_workspace_c2pa_observation(request: C2paObservationRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::CreateC2paObservation(request)))
}

#[napi]
pub fn get_local_signer_status() -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::GetSignerStatus))
}

#[napi]
pub fn create_local_signer(request: SignerLabelRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::CreateSigner(request)))
}

#[napi]
pub fn rotate_local_signer(request: SignerLabelRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::RotateSigner(request)))
}

#[napi]
pub fn disable_local_signer() -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::DisableSigner))
}

#[napi]
pub fn initialize_app_state(request: DatabaseRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::InitializeAppState(request)))
}

#[napi]
pub fn get_app_state(request: DatabaseRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::GetAppState(request)))
}

#[napi]
pub fn set_app_preference(request: SetPreferenceRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::SetPreference(request)))
}

#[napi]
pub fn remember_recent_item(request: RememberRecentRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::RememberRecent(request)))
}

#[napi]
pub fn rebuild_recent_indexes(request: DatabaseRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::RebuildRecents(request)))
}

fn run_operation(operation: &Operation) -> String {
    run_operation_with_signer(operation, &configured_signer())
}

fn configured_signer() -> SignerService<OsSignerKeyStore> {
    let enabled = std::env::var("AIGC_PROOF_TEST_SIGNER_ENABLED").as_deref() == Ok("1");
    let service = std::env::var("AIGC_PROOF_TEST_SIGNER_SERVICE").ok();
    if enabled
        && service.as_deref().is_some_and(|value| {
            value.starts_with("org.aigcproof.qa.")
                && value.len() <= 120
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        })
    {
        return SignerService::new(OsSignerKeyStore::new(
            service.unwrap(),
            proof_core::DEFAULT_SIGNER_USER,
        ));
    }
    SignerService::production()
}

fn run_operation_with_signer<S: proof_core::SignerKeyStore>(
    operation: &Operation,
    signer: &SignerService<S>,
) -> String {
    let result = execute(operation, signer);
    let envelope = match result {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    serde_json::to_string(&envelope).unwrap_or_else(|error| {
        let mut message = String::new();
        let _ = write!(message, "bridge serialization failed: {error}");
        "{\"ok\":false,\"error\":{\"code\":\"BRIDGE_SERIALIZATION_FAILED\",\"message\":\"Bridge serialization failed.\"}}".to_owned()
    })
}

fn execute<S: proof_core::SignerKeyStore>(
    operation: &Operation,
    signer: &SignerService<S>,
) -> Result<Value, BridgeFailure> {
    match operation {
        Operation::InitializeWorkspace(request) => {
            let path = safe_path(&request.path, "workspace")?;
            let workspace = init_workspace(InitWorkspaceOptions {
                path: path.clone(),
                project_name: nonempty(request.project_name.clone()),
                created_at: current_timestamp().map_err(BridgeFailure::core)?,
            })
            .map_err(BridgeFailure::core)?;
            Ok(json!({ "path": path, "workspace": workspace }))
        }
        Operation::LoadWorkspace(request) => {
            let path = safe_path(&request.path, "workspace")?;
            let workspace = load_workspace(&path).map_err(BridgeFailure::core)?;
            Ok(json!({ "path": path, "workspace": workspace }))
        }
        Operation::AddAsset(request) => {
            let workspace = safe_path(&request.workspace, "workspace")?;
            let source = safe_path(&request.source, "source")?;
            let role = AssetRole::from_str(&request.role)
                .map_err(|message| BridgeFailure::input("INVALID_ASSET_ROLE", message))?;
            let asset = add_asset(AddAssetOptions {
                workspace: workspace.clone(),
                media_type: media_type_for_path(&source).to_owned(),
                source,
                role,
                asset_id: Uuid::new_v4().to_string(),
            })
            .map_err(BridgeFailure::core)?;
            let summary = load_workspace(&workspace).map_err(BridgeFailure::core)?;
            Ok(json!({ "asset": asset, "workspace": summary }))
        }
        Operation::ExportWorkspaceOutput(request) => {
            let workspace = safe_path(&request.workspace, "workspace")?;
            let output = safe_path(&request.output, "output")?;
            let result = export_workspace_output(ExportWorkspaceOutputOptions {
                workspace,
                asset_id: request.asset_id.clone(),
                output,
            })
            .map_err(BridgeFailure::core)?;
            Ok(serde_json::to_value(result).map_err(BridgeFailure::serialization)?)
        }
        Operation::MatchImageToPackage(request) => {
            let package = safe_path(&request.package, "package")?;
            let image = safe_path(&request.image, "image")?;
            let result = match_image_to_package(
                &package,
                &image,
                &VerificationLimits::default(),
                current_timestamp().map_err(BridgeFailure::core)?,
            )
            .map_err(BridgeFailure::core)?;
            Ok(serde_json::to_value(result).map_err(BridgeFailure::serialization)?)
        }
        Operation::RecordEvent(request) => {
            let workspace = safe_path(&request.workspace, "workspace")?;
            let payload = parse_json_strict(request.payload_json.as_bytes()).map_err(|error| {
                BridgeFailure::input("EVENT_PAYLOAD_INVALID", error.to_string())
            })?;
            let event = record_event(RecordEventOptions {
                workspace,
                event_id: Uuid::new_v4().to_string(),
                event_type: request.event_type.clone(),
                created_at: current_timestamp().map_err(BridgeFailure::core)?,
                payload,
            })
            .map_err(BridgeFailure::core)?;
            Ok(json!({ "event": event }))
        }
        Operation::SealPackage(request) => {
            if !request.confirm_signature {
                return Err(BridgeFailure::input(
                    "SIGNATURE_NOT_CONFIRMED",
                    "Explicit creator-signature confirmation is required.",
                ));
            }
            let workspace = safe_path(&request.workspace, "workspace")?;
            let output = safe_path(&request.output, "output")?;
            let options = SealOptions {
                workspace,
                output,
                proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
                created_at: current_timestamp().map_err(BridgeFailure::core)?,
            };
            let result = match request.tsa_profile_json.as_deref() {
                Some(profile_json) => {
                    let profile = parse_tsa_profile(profile_json).map_err(BridgeFailure::core)?;
                    seal_signed_workspace_with_timestamp(
                        options,
                        signer,
                        &profile,
                        request.timestamp_policy.as_deref().unwrap_or("any"),
                    )
                }
                None => seal_signed_workspace(options, signer),
            }
            .map_err(BridgeFailure::core)?;
            Ok(json!({ "path": result.path, "manifest": result.manifest }))
        }
        Operation::VerifyPackage(request) => {
            let path = safe_path(&request.path, "package")?;
            let now = current_timestamp().map_err(BridgeFailure::core)?;
            let report = match request.tsa_profile_json.as_deref() {
                Some(profile_json) => {
                    let profile = parse_tsa_profile(profile_json).map_err(BridgeFailure::core)?;
                    verify_package_with_signer_and_profile(
                        &path,
                        &VerificationLimits::default(),
                        now,
                        signer,
                        &profile,
                    )
                }
                None => {
                    verify_package_with_signer(&path, &VerificationLimits::default(), now, signer)
                }
            };
            Ok(serde_json::to_value(report).map_err(BridgeFailure::serialization)?)
        }
        Operation::InspectPackage(request) => {
            let path = safe_path(&request.path, "package")?;
            let inspection = inspect_package(&path, &VerificationLimits::default())
                .map_err(BridgeFailure::core)?;
            Ok(serde_json::to_value(inspection).map_err(BridgeFailure::serialization)?)
        }
        Operation::ValidateTsaProfile(request) => {
            let profile = parse_tsa_profile(&request.profile_json).map_err(BridgeFailure::core)?;
            Ok(serde_json::to_value(tsa_profile_summary(&profile))
                .map_err(BridgeFailure::serialization)?)
        }
        Operation::PrepareTimestamp(request) => {
            let package = safe_path(&request.package, "package")?;
            let profile = parse_tsa_profile(&request.profile_json).map_err(BridgeFailure::core)?;
            let prepared = prepare_timestamp_request(
                &package,
                &profile,
                &VerificationLimits::default(),
                current_timestamp().map_err(BridgeFailure::core)?,
            )
            .map_err(BridgeFailure::core)?;
            Ok(json!({
                "timestampPath": prepared.timestamp_path,
                "disclosure": prepared.disclosure,
            }))
        }
        Operation::AttachTimestamp(request) => {
            let package = safe_path(&request.package, "package")?;
            let output = safe_path(&request.output, "output")?;
            let response_path = safe_path(&request.response_path, "timestamp response")?;
            let profile = parse_tsa_profile(&request.profile_json).map_err(BridgeFailure::core)?;
            let metadata = fs::symlink_metadata(&response_path).map_err(|error| {
                BridgeFailure::input("TIMESTAMP_RESPONSE_FILE_INVALID", error.to_string())
            })?;
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || metadata.len() == 0
                || metadata.len() > 1024 * 1024
            {
                return Err(BridgeFailure::input(
                    "TIMESTAMP_RESPONSE_FILE_INVALID",
                    "Timestamp response must be a regular 1 byte to 1 MiB file.",
                ));
            }
            let response = fs::read(&response_path).map_err(|error| {
                BridgeFailure::input("TIMESTAMP_RESPONSE_READ_FAILED", error.to_string())
            })?;
            let attached = attach_timestamp_response(
                &package,
                &output,
                &response,
                &profile,
                &VerificationLimits::default(),
                current_timestamp().map_err(BridgeFailure::core)?,
            )
            .map_err(BridgeFailure::core)?;
            Ok(json!({
                "path": attached.path,
                "timestampPath": attached.timestamp_path,
                "trustedTime": attached.gen_time,
            }))
        }
        Operation::ValidateC2paProfile(request) => {
            let profile =
                parse_c2pa_trust_profile(&request.profile_json).map_err(BridgeFailure::core)?;
            Ok(json!({
                "profile": profile.profile.profile,
                "profileSha256": profile.digest,
                "signerSnapshotSha256": profile.signer_snapshot_sha256,
                "timestampSnapshotSha256": profile.timestamp_snapshot_sha256,
                "signerSource": profile.profile.signer.source_label,
                "timestampSource": profile.profile.timestamp.source_label,
            }))
        }
        Operation::InspectC2pa(request) => {
            let asset = safe_path(&request.asset, "C2PA asset")?;
            let sidecar = request
                .sidecar
                .as_deref()
                .map(|value| safe_path(value, "C2PA sidecar"))
                .transpose()?;
            let profile =
                parse_c2pa_trust_profile(&request.profile_json).map_err(BridgeFailure::core)?;
            let inspection = inspect_c2pa(C2paInspectOptions {
                asset_path: asset,
                sidecar_path: sidecar,
                trust_profile: &profile,
                observed_at: current_timestamp().map_err(BridgeFailure::core)?,
            })
            .map_err(BridgeFailure::core)?;
            Ok(serde_json::to_value(inspection).map_err(BridgeFailure::serialization)?)
        }
        Operation::CreateC2paObservation(request) => {
            let workspace = safe_path(&request.workspace, "workspace")?;
            let sidecar = request
                .sidecar
                .as_deref()
                .map(|value| safe_path(value, "C2PA sidecar"))
                .transpose()?;
            let profile =
                parse_c2pa_trust_profile(&request.profile_json).map_err(BridgeFailure::core)?;
            let now = current_timestamp().map_err(BridgeFailure::core)?;
            let event = create_c2pa_observation(CreateC2paObservationOptions {
                workspace: workspace.clone(),
                asset_id: request.asset_id.clone(),
                sidecar_path: sidecar,
                trust_profile: &profile,
                event_id: Uuid::new_v4().to_string(),
                created_at: now,
            })
            .map_err(BridgeFailure::core)?;
            let summary = load_workspace(&workspace).map_err(BridgeFailure::core)?;
            Ok(json!({ "event": event, "workspace": summary }))
        }
        Operation::GetSignerStatus => {
            Ok(serde_json::to_value(signer.status()).map_err(BridgeFailure::serialization)?)
        }
        Operation::CreateSigner(request) => Ok(serde_json::to_value(
            signer
                .create(&request.display_label)
                .map_err(BridgeFailure::core)?,
        )
        .map_err(BridgeFailure::serialization)?),
        Operation::RotateSigner(request) => Ok(serde_json::to_value(
            signer
                .rotate(&request.display_label)
                .map_err(BridgeFailure::core)?,
        )
        .map_err(BridgeFailure::serialization)?),
        Operation::DisableSigner => Ok(serde_json::to_value(
            signer.disable().map_err(BridgeFailure::core)?,
        )
        .map_err(BridgeFailure::serialization)?),
        Operation::InitializeAppState(request) | Operation::GetAppState(request) => {
            let database = safe_path(&request.database, "database")?;
            let state = app_state::initialize(&database)?;
            Ok(serde_json::to_value(state).map_err(BridgeFailure::serialization)?)
        }
        Operation::SetPreference(request) => {
            let database = safe_path(&request.database, "database")?;
            let state = app_state::set_preference(&database, &request.key, &request.value)?;
            Ok(serde_json::to_value(state).map_err(BridgeFailure::serialization)?)
        }
        Operation::RememberRecent(request) => {
            let database = safe_path(&request.database, "database")?;
            let path = safe_path(&request.path, "recent path")?;
            let state = app_state::remember_recent(
                &database,
                &request.kind,
                &path,
                &current_timestamp().map_err(BridgeFailure::core)?,
            )?;
            Ok(serde_json::to_value(state).map_err(BridgeFailure::serialization)?)
        }
        Operation::RebuildRecents(request) => {
            let database = safe_path(&request.database, "database")?;
            let state = app_state::rebuild_recents(&database)?;
            Ok(serde_json::to_value(state).map_err(BridgeFailure::serialization)?)
        }
    }
}

fn safe_path(value: &str, label: &str) -> Result<PathBuf, BridgeFailure> {
    if value.trim().is_empty() || value.contains('\0') || value.len() > 32_767 {
        return Err(BridgeFailure::input(
            "PATH_INVALID",
            format!("{label} path is empty or invalid."),
        ));
    }
    Ok(PathBuf::from(value))
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFailure {
    code: String,
    kind: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

impl BridgeFailure {
    fn new(code: impl Into<String>, message: impl Into<String>, path: Option<PathBuf>) -> Self {
        Self {
            code: code.into(),
            kind: "bridge".to_owned(),
            message: message.into(),
            path: path.map(|value| value.to_string_lossy().into_owned()),
        }
    }

    fn input(code: impl Into<String>, message: impl Into<String>) -> Self {
        let mut failure = Self::new(code, message, None);
        failure.kind = "input".to_owned();
        failure
    }

    fn core(error: CoreError) -> Self {
        Self {
            code: error.code.to_owned(),
            kind: format!("{:?}", error.kind),
            message: error.message,
            path: error.path.map(|value| value.to_string_lossy().into_owned()),
        }
    }

    fn database(error: SqliteError) -> Self {
        let mut failure = Self::new("APP_STATE_DATABASE_ERROR", error.to_string(), None);
        failure.kind = "database".to_owned();
        failure
    }

    fn serialization(error: serde_json::Error) -> Self {
        Self::new("BRIDGE_SERIALIZATION_FAILED", error.to_string(), None)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Mutex;

    use serde_json::Value;
    use tempfile::tempdir;
    use zeroize::Zeroizing;

    use super::*;

    #[derive(Default)]
    struct MemoryStore(Mutex<Option<Zeroizing<Vec<u8>>>>);

    impl proof_core::SignerKeyStore for MemoryStore {
        fn load(&self) -> Result<Option<Zeroizing<Vec<u8>>>, proof_core::KeyStoreError> {
            Ok(self
                .0
                .lock()
                .unwrap()
                .as_ref()
                .map(|value| Zeroizing::new(value.to_vec())))
        }

        fn store(&self, value: &[u8]) -> Result<(), proof_core::KeyStoreError> {
            *self.0.lock().unwrap() = Some(Zeroizing::new(value.to_vec()));
            Ok(())
        }

        fn delete(&self) -> Result<(), proof_core::KeyStoreError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn discovery_is_exact_deterministic_and_truthful() {
        let info = get_api_info();
        assert_eq!(info.api_version, "1.6.0");
        assert_eq!(info.engine_version, "0.5.0");
        assert_eq!(
            info.supported_protocol_versions,
            ["0.2.0", "0.3.0", "0.4.0", "0.5.0"]
        );
        assert_eq!(
            info.capabilities,
            NATIVE_CAPABILITIES
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>()
        );
        assert!(info.capabilities.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(info.execution.napi_async_tasks);
        assert!(info.execution.utility_process_isolation);
        assert!(info.execution.progress_streaming);
        assert!(!info.execution.safe_cancellation);
        assert_eq!(info.limits.max_concurrent_jobs, 1);
        assert_eq!(info.limits.max_queued_jobs, 16);
        assert_eq!(info.limits.max_message_bytes, 1024 * 1024);
    }

    fn data(operation: Operation) -> Value {
        let envelope: Value = serde_json::from_str(&run_operation(&operation)).unwrap();
        assert_eq!(envelope["ok"], true, "{envelope}");
        envelope["data"].clone()
    }

    #[test]
    fn bridge_matches_core_workflow_and_preserves_no_clobber() {
        let root = tempdir().unwrap();
        let signer = SignerService::new(MemoryStore::default());
        signer.create("Bridge test creator").unwrap();
        let data = |operation| {
            let envelope: Value =
                serde_json::from_str(&run_operation_with_signer(&operation, &signer)).unwrap();
            assert_eq!(envelope["ok"], true, "{envelope}");
            envelope["data"].clone()
        };
        let workspace = root.path().join("项目 工作区");
        let input = root.path().join("输入 文件.txt");
        let output_asset = root.path().join("output.png");
        let package = root.path().join("proof.aigcproof");
        fs::write(&input, b"bridge input").unwrap();
        fs::write(&output_asset, b"\x89PNG\r\n\x1a\nbridge output").unwrap();

        data(Operation::InitializeWorkspace(InitializeWorkspaceRequest {
            path: workspace.to_string_lossy().into_owned(),
            project_name: Some("桥接测试".to_owned()),
        }));
        let mut output_asset_id = None;
        for (source, role) in [(&input, "input"), (&output_asset, "output")] {
            let added = data(Operation::AddAsset(AddAssetRequest {
                workspace: workspace.to_string_lossy().into_owned(),
                source: source.to_string_lossy().into_owned(),
                role: role.to_owned(),
            }));
            if role == "output" {
                output_asset_id = added["asset"]["asset_id"].as_str().map(str::to_owned);
            }
        }
        data(Operation::RecordEvent(RecordEventRequest {
            workspace: workspace.to_string_lossy().into_owned(),
            event_type: "generation".to_owned(),
            payload_json: "{\"model\":\"bridge-test\"}".to_owned(),
        }));
        data(Operation::SealPackage(SealPackageRequest {
            workspace: workspace.to_string_lossy().into_owned(),
            output: package.to_string_lossy().into_owned(),
            confirm_signature: true,
            tsa_profile_json: None,
            timestamp_policy: None,
        }));
        let verification = data(Operation::VerifyPackage(VerifyPackageRequest {
            path: package.to_string_lossy().into_owned(),
            tsa_profile_json: None,
        }));
        assert_eq!(verification["status"], "valid");
        let inspection = data(Operation::InspectPackage(PathRequest {
            path: package.to_string_lossy().into_owned(),
        }));
        assert_eq!(inspection["verification_performed"], false);

        let matched = data(Operation::MatchImageToPackage(MatchImageToPackageRequest {
            package: package.to_string_lossy().into_owned(),
            image: output_asset.to_string_lossy().into_owned(),
        }));
        assert_eq!(matched["status"], "verified_output_match");
        assert_eq!(matched["matched_assets"][0]["role"], "output");

        let exported = root.path().join("exported output.png");
        let export = data(Operation::ExportWorkspaceOutput(
            ExportWorkspaceOutputRequest {
                workspace: workspace.to_string_lossy().into_owned(),
                asset_id: output_asset_id.unwrap(),
                output: exported.to_string_lossy().into_owned(),
            },
        ));
        assert_eq!(export["sha256"], matched["file_sha256"]);
        assert_eq!(
            fs::read(&exported).unwrap(),
            b"\x89PNG\r\n\x1a\nbridge output"
        );

        let second: Value = serde_json::from_str(&run_operation_with_signer(
            &Operation::SealPackage(SealPackageRequest {
                workspace: workspace.to_string_lossy().into_owned(),
                output: package.to_string_lossy().into_owned(),
                confirm_signature: true,
                tsa_profile_json: None,
                timestamp_policy: None,
            }),
            &signer,
        ))
        .unwrap();
        assert_eq!(second["ok"], false);
        assert_eq!(second["error"]["code"], "OUTPUT_ALREADY_EXISTS");
    }

    #[test]
    fn malformed_input_and_sqlite_rebuild_are_stable() {
        let root = tempdir().unwrap();
        let database = root.path().join("state").join("workbench.sqlite3");
        let missing = root.path().join("missing-workspace");
        data(Operation::InitializeAppState(DatabaseRequest {
            database: database.to_string_lossy().into_owned(),
        }));
        let state = data(Operation::SetPreference(SetPreferenceRequest {
            database: database.to_string_lossy().into_owned(),
            key: "theme".to_owned(),
            value: "dark".to_owned(),
        }));
        assert_eq!(state["preferences"]["theme"], "dark");
        data(Operation::RememberRecent(RememberRecentRequest {
            database: database.to_string_lossy().into_owned(),
            kind: "workspace".to_owned(),
            path: missing.to_string_lossy().into_owned(),
        }));
        assert!(app_state::contains_recent(&database, "workspace", &missing).unwrap());
        let rebuilt = data(Operation::RebuildRecents(DatabaseRequest {
            database: database.to_string_lossy().into_owned(),
        }));
        assert_eq!(rebuilt["recentWorkspaces"].as_array().unwrap().len(), 0);

        let malformed: Value = serde_json::from_str(&run_operation(&Operation::RecordEvent(
            RecordEventRequest {
                workspace: missing.to_string_lossy().into_owned(),
                event_type: "generation".to_owned(),
                payload_json: "{\"duplicate\":1,\"duplicate\":2}".to_owned(),
            },
        )))
        .unwrap();
        assert_eq!(malformed["ok"], false);
        assert_eq!(malformed["error"]["code"], "EVENT_PAYLOAD_INVALID");
    }
}
