use std::fmt;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    Io,
    InvalidWorkspace,
    InvalidPackagePath,
    UnsupportedSpecVersion,
    SchemaValidation,
    InvalidTimestamp,
    InvalidDigest,
    HashMismatch,
    MissingAsset,
    MissingEvent,
    InvalidEventChain,
    UnsafeZipEntry,
    DuplicateZipEntry,
    CaseConflictingZipEntry,
    SymbolicLinkEntry,
    LimitExceeded,
    MalformedJson,
    PackageFormat,
    OutputAlreadyExists,
    CredentialStore,
    Signing,
}

#[derive(Debug)]
pub struct CoreError {
    pub kind: ErrorKind,
    pub code: &'static str,
    pub path: Option<PathBuf>,
    pub message: String,
}

impl CoreError {
    pub fn new(kind: ErrorKind, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            code,
            path: None,
            message: message.into(),
        }
    }

    pub fn at_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn io(code: &'static str, path: &std::path::Path, error: std::io::Error) -> Self {
        Self::new(ErrorKind::Io, code, error.to_string()).at_path(path)
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(path) = &self.path {
            write!(
                formatter,
                "{} at {}: {}",
                self.code,
                path.display(),
                self.message
            )
        } else {
            write!(formatter, "{}: {}", self.code, self.message)
        }
    }
}

impl std::error::Error for CoreError {}

impl From<serde_json::Error> for CoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(
            ErrorKind::MalformedJson,
            "MALFORMED_JSON",
            error.to_string(),
        )
    }
}

impl From<zip::result::ZipError> for CoreError {
    fn from(error: zip::result::ZipError) -> Self {
        Self::new(
            ErrorKind::PackageFormat,
            "PACKAGE_FORMAT_ERROR",
            error.to_string(),
        )
    }
}

pub type CoreResult<T> = Result<T, CoreError>;
