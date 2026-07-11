use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use proof_schema::{CheckStatus, Inspection, VerificationReport, VerificationStatus};
use serde::{Deserialize, Serialize};
use tempfile::Builder;

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentState {
    #[serde(default)]
    pub workspaces: Vec<PathBuf>,
    #[serde(default)]
    pub packages: Vec<PathBuf>,
}

impl RecentState {
    pub fn remember_workspace(&mut self, path: PathBuf) {
        remember(&mut self.workspaces, path);
    }

    pub fn remember_package(&mut self, path: PathBuf) {
        remember(&mut self.packages, path);
    }
}

fn remember(items: &mut Vec<PathBuf>, path: PathBuf) {
    items.retain(|item| item != &path);
    items.insert(0, path);
    items.truncate(8);
}

pub fn load_recent_state(path: &Path) -> RecentState {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save_recent_state(path: &Path, state: &RecentState) -> Result<(), String> {
    let parent = path.parent().ok_or("recent-state path has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-desktop-state-")
        .tempfile_in(parent)
        .map_err(|error| error.to_string())?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|error| error.error.to_string())
}

pub fn save_report_no_clobber(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if path.exists() {
        return Err("REPORT_ALREADY_EXISTS: 报告文件已存在，不会覆盖。".to_owned());
    }
    let mut temporary = Builder::new()
        .prefix(".aigc-proof-desktop-report-")
        .tempfile_in(parent)
        .map_err(|error| error.to_string())?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    temporary
        .persist_noclobber(path)
        .map(|_| ())
        .map_err(|error| format!("REPORT_ALREADY_EXISTS_OR_UNWRITABLE: {}", error.error))
}

pub fn format_verification(report: &VerificationReport) -> String {
    let mut lines = vec![
        format!("验证状态：{}", verification_status(&report.status)),
        format!("证明 ID：{}", report.proof_id.as_deref().unwrap_or("未知")),
        String::new(),
        "能力边界：仅验证包内完整性".to_owned(),
        "创建者身份：未验证；数字签名：不存在；可信时间：不存在；原创性：未评估".to_owned(),
        String::new(),
        "阶段结果：".to_owned(),
    ];
    for check in &report.checks {
        lines.push(format!(
            "- [{}] {} — {}",
            check_status(&check.status),
            check.code,
            check.message
        ));
    }
    if !report.errors.is_empty() {
        lines.push(String::new());
        lines.push("错误：".to_owned());
        for error in &report.errors {
            let path = error
                .path
                .as_deref()
                .map(|value| format!("；路径：{value}"))
                .unwrap_or_default();
            lines.push(format!("- {}：{}{}", error.code, error.message, path));
        }
    }
    lines.join("\r\n")
}

fn verification_status(status: &VerificationStatus) -> &'static str {
    match status {
        VerificationStatus::Valid => "valid（有效）",
        VerificationStatus::Invalid => "invalid（无效）",
        VerificationStatus::Error => "error（错误）",
    }
}

fn check_status(status: &CheckStatus) -> &'static str {
    match status {
        CheckStatus::Pass => "pass",
        CheckStatus::Fail => "fail",
        CheckStatus::Skipped => "skipped",
    }
}

pub fn format_inspection(inspection: &Inspection) -> String {
    let mut lines = vec![
        "检查结果（未执行完整性验证）".to_owned(),
        "请使用“验证证明包”判断包内完整性。".to_owned(),
        String::new(),
        format!("证明 ID：{}", inspection.proof_id),
        format!("协议版本：{}", inspection.spec_version),
        format!("创建时间（不可信）：{}", inspection.created_at),
        format!("资产数量：{}", inspection.assets.len()),
        format!("事件数量：{}", inspection.event_chain.event_count),
        String::new(),
        "创建者身份：未验证；数字签名：不存在；可信时间：不存在；原创性：未评估".to_owned(),
    ];
    for asset in &inspection.assets {
        lines.push(format!(
            "- [{}] {}（{} 字节）",
            asset.role, asset.original_name, asset.size_bytes
        ));
    }
    lines.join("\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_items_are_deduplicated_and_bounded() {
        let mut state = RecentState::default();
        for index in 0..10 {
            state.remember_workspace(PathBuf::from(format!("workspace-{index}")));
        }
        assert_eq!(state.workspaces.len(), 8);
        state.remember_workspace(PathBuf::from("workspace-5"));
        assert_eq!(state.workspaces[0], PathBuf::from("workspace-5"));
        assert_eq!(
            state
                .workspaces
                .iter()
                .filter(|path| *path == &PathBuf::from("workspace-5"))
                .count(),
            1
        );
    }

    #[test]
    fn report_persistence_refuses_overwrite() {
        let temp = tempfile::tempdir().unwrap();
        let report = temp.path().join("report.json");
        save_report_no_clobber(&report, b"first").unwrap();
        assert!(save_report_no_clobber(&report, b"second").is_err());
        assert_eq!(fs::read(report).unwrap(), b"first");
    }
}
