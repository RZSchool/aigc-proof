//! Offline AIGC-Proof 0.2-1.0 workspace, signed package, and verification operations.

mod asset_match;
mod c2pa_bridge;
mod error;
mod event_chain;
mod hash;
mod official_attestation;
mod package;
mod signing;
mod timestamp;
mod timestamp_package;
mod verify;
mod workspace;

pub use c2pa_bridge::{
    C2PA_MAX_ASSERTIONS, C2PA_MAX_ASSET_BYTES, C2PA_MAX_ELAPSED, C2PA_MAX_INGREDIENTS,
    C2PA_MAX_MANIFEST_BYTES, C2PA_MAX_MANIFESTS, C2paHostSignRequest, C2paHostSigningCallback,
    C2paInspectOptions, C2paInspection, C2paSigningAlgorithm, CreateC2paObservationOptions,
    ParsedC2paTrustProfile, create_c2pa_observation, inspect_c2pa, parse_c2pa_trust_profile,
    sign_c2pa_with_host_callback,
};
pub use error::{CoreError, CoreResult, ErrorKind};
pub use event_chain::{
    EventChainIssue, canonical_json, create_event, event_digest, verify_event_chain,
};
pub use hash::{DigestResult, sha256_bytes, sha256_file, sha256_reader};
pub use official_attestation::{
    OFFICIAL_DEFAULT_MAX_STATUS_AGE_SECONDS, OFFICIAL_MAX_COSE_BYTES, OFFICIAL_MAX_JSON_BYTES,
    OFFICIAL_MAX_STATUS_ENTRIES, OfficialIdentityVerifyOptions, verify_official_identity,
};
pub use package::{
    SealOptions, SealResult, seal_signed_workspace, seal_signed_workspace_with_timestamp,
    seal_workspace,
};
pub use signing::{
    DEFAULT_SIGNER_SERVICE, DEFAULT_SIGNER_USER, KeyStoreError, LocalSignerState,
    LocalSignerStatus, OsSignerKeyStore, SignerKeyStore, SignerService,
};
pub use timestamp::{
    ParsedTsaProfile, TimestampRequestDisclosure, TimestampVerification, build_timestamp_request,
    parse_tsa_profile, random_timestamp_nonce, tsa_profile_summary, verify_timestamp_strict,
};
pub use timestamp_package::{
    AttachTimestampResult, PreparedTimestampRequest, attach_timestamp_response,
    prepare_timestamp_request,
};
pub use verify::{
    VerificationLimits, inspect_package, verify_package, verify_package_with_profile,
    verify_package_with_signer, verify_package_with_signer_and_profile,
};
pub use workspace::{
    AddAssetOptions, ExportWorkspaceOutputOptions, ExportWorkspaceOutputResult,
    InitWorkspaceOptions, RecordEventOptions, add_asset, export_workspace_output, init_workspace,
    load_workspace, media_type_for_path, record_event,
};

pub const SPEC_VERSION: &str = "1.0.0";

pub fn current_timestamp() -> CoreResult<String> {
    proof_schema::format_canonical_utc(time::OffsetDateTime::now_utc()).map_err(|message| {
        CoreError::new(ErrorKind::InvalidTimestamp, "INVALID_TIMESTAMP", message)
    })
}
pub use asset_match::{PackageAssetMatch, PackageAssetMatchStatus, match_image_to_package};
