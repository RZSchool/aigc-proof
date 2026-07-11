//! Offline AIGC-Proof 0.2 workspace, package, and verification operations.

mod error;
mod event_chain;
mod hash;
mod package;
mod verify;
mod workspace;

pub use error::{CoreError, CoreResult, ErrorKind};
pub use event_chain::{
    EventChainIssue, canonical_json, create_event, event_digest, verify_event_chain,
};
pub use hash::{DigestResult, sha256_bytes, sha256_file, sha256_reader};
pub use package::{SealOptions, SealResult, seal_workspace};
pub use verify::{VerificationLimits, inspect_package, verify_package};
pub use workspace::{
    AddAssetOptions, InitWorkspaceOptions, RecordEventOptions, add_asset, init_workspace,
    load_workspace, media_type_for_path, record_event,
};

pub const SPEC_VERSION: &str = "0.2.0";

pub fn current_timestamp() -> CoreResult<String> {
    proof_schema::format_canonical_utc(time::OffsetDateTime::now_utc()).map_err(|message| {
        CoreError::new(ErrorKind::InvalidTimestamp, "INVALID_TIMESTAMP", message)
    })
}
