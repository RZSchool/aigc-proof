mod app_state;

use std::fmt::Write as _;
use std::path::PathBuf;
use std::str::FromStr;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use proof_core::{
    AddAssetOptions, CoreError, InitWorkspaceOptions, RecordEventOptions, SealOptions,
    VerificationLimits, add_asset, current_timestamp, init_workspace, inspect_package,
    load_workspace, media_type_for_path, record_event, seal_workspace, verify_package,
};
use proof_schema::{AssetRole, parse_json_strict};
use rusqlite::Error as SqliteError;
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

pub const NATIVE_API_VERSION: &str = "1.2.0";
pub const NATIVE_ENGINE_VERSION: &str = "0.2.0";
pub const SUPPORTED_PROTOCOL_VERSION: &str = "0.2.0";
pub const NATIVE_CAPABILITIES: &[&str] = &[
    "execution.phase-progress",
    "proof.asset.add",
    "proof.event.record",
    "proof.package.inspect",
    "proof.package.seal",
    "proof.package.verify",
    "proof.workspace.create",
    "proof.workspace.open",
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
        supported_protocol_versions: vec![SUPPORTED_PROTOCOL_VERSION.to_owned()],
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
    RecordEvent(RecordEventRequest),
    SealPackage(SealPackageRequest),
    VerifyPackage(PathRequest),
    InspectPackage(PathRequest),
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
pub fn record_workspace_event(request: RecordEventRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::RecordEvent(request)))
}

#[napi]
pub fn seal_proof_package(request: SealPackageRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::SealPackage(request)))
}

#[napi]
pub fn verify_proof_package(request: PathRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::VerifyPackage(request)))
}

#[napi]
pub fn inspect_proof_package(request: PathRequest) -> AsyncTask<BridgeTask> {
    AsyncTask::new(BridgeTask::new(Operation::InspectPackage(request)))
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
    let result = execute(operation);
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

fn execute(operation: &Operation) -> Result<Value, BridgeFailure> {
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
            let workspace = safe_path(&request.workspace, "workspace")?;
            let output = safe_path(&request.output, "output")?;
            let result = seal_workspace(SealOptions {
                workspace,
                output,
                proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
                created_at: current_timestamp().map_err(BridgeFailure::core)?,
            })
            .map_err(BridgeFailure::core)?;
            Ok(json!({ "path": result.path, "manifest": result.manifest }))
        }
        Operation::VerifyPackage(request) => {
            let path = safe_path(&request.path, "package")?;
            let report = verify_package(
                &path,
                &VerificationLimits::default(),
                current_timestamp().map_err(BridgeFailure::core)?,
            );
            Ok(serde_json::to_value(report).map_err(BridgeFailure::serialization)?)
        }
        Operation::InspectPackage(request) => {
            let path = safe_path(&request.path, "package")?;
            let inspection = inspect_package(&path, &VerificationLimits::default())
                .map_err(BridgeFailure::core)?;
            Ok(serde_json::to_value(inspection).map_err(BridgeFailure::serialization)?)
        }
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

    use serde_json::Value;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn discovery_is_exact_deterministic_and_truthful() {
        let info = get_api_info();
        assert_eq!(info.api_version, "1.2.0");
        assert_eq!(info.engine_version, "0.2.0");
        assert_eq!(info.supported_protocol_versions, ["0.2.0"]);
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
        let workspace = root.path().join("项目 工作区");
        let input = root.path().join("输入 文件.txt");
        let output_asset = root.path().join("output.txt");
        let package = root.path().join("proof.aigcproof");
        fs::write(&input, b"bridge input").unwrap();
        fs::write(&output_asset, b"bridge output").unwrap();

        data(Operation::InitializeWorkspace(InitializeWorkspaceRequest {
            path: workspace.to_string_lossy().into_owned(),
            project_name: Some("桥接测试".to_owned()),
        }));
        for (source, role) in [(&input, "input"), (&output_asset, "output")] {
            data(Operation::AddAsset(AddAssetRequest {
                workspace: workspace.to_string_lossy().into_owned(),
                source: source.to_string_lossy().into_owned(),
                role: role.to_owned(),
            }));
        }
        data(Operation::RecordEvent(RecordEventRequest {
            workspace: workspace.to_string_lossy().into_owned(),
            event_type: "generation".to_owned(),
            payload_json: "{\"model\":\"bridge-test\"}".to_owned(),
        }));
        data(Operation::SealPackage(SealPackageRequest {
            workspace: workspace.to_string_lossy().into_owned(),
            output: package.to_string_lossy().into_owned(),
        }));
        let verification = data(Operation::VerifyPackage(PathRequest {
            path: package.to_string_lossy().into_owned(),
        }));
        assert_eq!(verification["status"], "valid");
        let inspection = data(Operation::InspectPackage(PathRequest {
            path: package.to_string_lossy().into_owned(),
        }));
        assert_eq!(inspection["verification_performed"], false);

        let second: Value = serde_json::from_str(&run_operation(&Operation::SealPackage(
            SealPackageRequest {
                workspace: workspace.to_string_lossy().into_owned(),
                output: package.to_string_lossy().into_owned(),
            },
        )))
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
