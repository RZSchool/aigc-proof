#![allow(unsafe_op_in_unsafe_fn)]

use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::str::FromStr;
use std::thread;

use proof_core::{
    AddAssetOptions, InitWorkspaceOptions, RecordEventOptions, SealOptions, VerificationLimits,
    add_asset, current_timestamp, init_workspace, inspect_package, load_workspace,
    media_type_for_path, record_event, seal_workspace, verify_package,
};
use proof_schema::{AssetRole, parse_json_strict};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    COLOR_WINDOW, CreateFontW, DEFAULT_CHARSET, DeleteObject, HFONT,
};
use windows_sys::Win32::System::Com::{
    COINIT_APARTMENTTHREADED, CoInitializeEx, CoTaskMemFree, CoUninitialize,
};
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::SystemServices::{SS_CENTERIMAGE, SS_LEFT};
use windows_sys::Win32::UI::Controls::Dialogs::{
    GetOpenFileNameW, GetSaveFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_OVERWRITEPROMPT,
    OFN_PATHMUSTEXIST, OPENFILENAMEW,
};
use windows_sys::Win32::UI::Controls::{
    EM_SETREADONLY, ICC_PROGRESS_CLASS, INITCOMMONCONTROLSEX, InitCommonControlsEx, PBM_SETMARQUEE,
    PBS_MARQUEE, PROGRESS_CLASSW,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
use windows_sys::Win32::UI::Shell::{
    BIF_NEWDIALOGSTYLE, BIF_RETURNONLYFSDIRS, BROWSEINFOW, SHBrowseForFolderW, SHGetPathFromIDListW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::logic::{
    RecentState, format_inspection, format_verification, load_recent_state, save_recent_state,
    save_report_no_clobber,
};

const CLASS_NAME: &str = "AigcProofDesktopPreview";
const WM_OPERATION_COMPLETE: u32 = WM_APP + 1;
const AUTOMATION_COPYDATA_ID: usize = 0xA1C0_0200;

const ID_WORKSPACE: i32 = 101;
const ID_BROWSE_WORKSPACE: i32 = 102;
const ID_PROJECT: i32 = 103;
const ID_INIT_OPEN: i32 = 104;
const ID_RECENT_WORKSPACE: i32 = 105;
const ID_REOPEN_WORKSPACE: i32 = 106;
const ID_ASSET: i32 = 111;
const ID_BROWSE_ASSET: i32 = 112;
const ID_ROLE: i32 = 113;
const ID_ADD_ASSET: i32 = 114;
const ID_EVENT_TYPE: i32 = 121;
const ID_EVENT_PAYLOAD: i32 = 122;
const ID_RECORD_EVENT: i32 = 123;
const ID_SEAL_OUTPUT: i32 = 131;
const ID_BROWSE_SEAL: i32 = 132;
const ID_SEAL: i32 = 133;
const ID_PACKAGE: i32 = 141;
const ID_BROWSE_PACKAGE: i32 = 142;
const ID_VERIFY: i32 = 143;
const ID_INSPECT: i32 = 144;
const ID_SAVE_REPORT: i32 = 145;
const ID_RECENT_PACKAGE: i32 = 146;
const ID_REOPEN_PACKAGE: i32 = 147;
const ID_STATUS: i32 = 201;
const ID_RESULT: i32 = 202;

const ACTION_IDS: &[i32] = &[
    ID_INIT_OPEN,
    ID_ADD_ASSET,
    ID_RECORD_EVENT,
    ID_SEAL,
    ID_VERIFY,
    ID_INSPECT,
    ID_SAVE_REPORT,
];

struct AppState {
    hwnd: HWND,
    font: HFONT,
    recent: RecentState,
    state_path: PathBuf,
    last_report: Option<Vec<u8>>,
    busy: bool,
    automation_enabled: bool,
    automation_report_path: Option<PathBuf>,
    progress: HWND,
    status: HWND,
    result: HWND,
}

impl AppState {
    fn new() -> Self {
        let state_path = local_state_path();
        Self {
            hwnd: null_mut(),
            font: null_mut(),
            recent: load_recent_state(&state_path),
            state_path,
            last_report: None,
            busy: false,
            automation_enabled: std::env::args_os().any(|value| value == "--automation"),
            automation_report_path: None,
            progress: null_mut(),
            status: null_mut(),
            result: null_mut(),
        }
    }
}

struct OperationResult {
    text: String,
    is_error: bool,
    recent_workspace: Option<PathBuf>,
    recent_package: Option<PathBuf>,
    report: Option<Vec<u8>>,
}

#[derive(Deserialize)]
struct AutomationCommand {
    control_id: i32,
    value: String,
}

impl OperationResult {
    fn ok(text: String) -> Self {
        Self {
            text,
            is_error: false,
            recent_workspace: None,
            recent_package: None,
            report: None,
        }
    }

    fn error(error: impl std::fmt::Display) -> Self {
        Self {
            text: format!("操作失败\r\n\r\n{error}"),
            is_error: true,
            recent_workspace: None,
            recent_package: None,
            report: None,
        }
    }
}

pub fn run() -> Result<(), String> {
    unsafe {
        CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32);
        let common = INITCOMMONCONTROLSEX {
            dwSize: size_of::<INITCOMMONCONTROLSEX>() as u32,
            dwICC: ICC_PROGRESS_CLASS,
        };
        InitCommonControlsEx(&common);

        let instance = GetModuleHandleW(null());
        if instance.is_null() {
            CoUninitialize();
            return Err("无法读取当前程序模块。".to_owned());
        }
        let class_name = wide(CLASS_NAME);
        let window_class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: (COLOR_WINDOW + 1) as _,
            lpszClassName: class_name.as_ptr(),
            ..zeroed()
        };
        if RegisterClassW(&window_class) == 0 {
            CoUninitialize();
            return Err("无法注册桌面窗口。".to_owned());
        }

        let state = Box::new(AppState::new());
        let state_ptr = Box::into_raw(state);
        let title = wide("AIGC-Proof Desktop Preview 0.2");
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            1280,
            860,
            null_mut(),
            null_mut(),
            instance,
            state_ptr.cast::<c_void>(),
        );
        if hwnd.is_null() {
            drop(Box::from_raw(state_ptr));
            CoUninitialize();
            return Err("无法创建桌面窗口。".to_owned());
        }

        let mut message: MSG = zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        CoUninitialize();
    }
    Ok(())
}

pub fn show_fatal_error(error: &str) {
    let _ = std::fs::write(
        std::env::temp_dir().join("aigc-proof-desktop-fatal.txt"),
        error.as_bytes(),
    );
    unsafe {
        let title = wide("AIGC-Proof 启动失败");
        let message = wide(error);
        MessageBoxW(
            null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        if message == WM_NCCREATE {
            let create = lparam as *const CREATESTRUCTW;
            let state = (*create).lpCreateParams as *mut AppState;
            (*state).hwnd = hwnd;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);
        }
        let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppState;
        match message {
            WM_CREATE if !state_ptr.is_null() => {
                create_controls(&mut *state_ptr);
                return 0;
            }
            WM_COMMAND if !state_ptr.is_null() => {
                let command_id = (wparam & 0xffff) as i32;
                handle_command(&mut *state_ptr, command_id);
                return 0;
            }
            WM_COPYDATA if !state_ptr.is_null() => {
                return handle_automation_copydata(&mut *state_ptr, lparam);
            }
            WM_OPERATION_COMPLETE if !state_ptr.is_null() => {
                let result = Box::from_raw(lparam as *mut OperationResult);
                finish_operation(&mut *state_ptr, *result);
                return 0;
            }
            WM_DESTROY => {
                if !state_ptr.is_null() {
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                    let state = Box::from_raw(state_ptr);
                    if !state.font.is_null() {
                        DeleteObject(state.font);
                    }
                }
                PostQuitMessage(0);
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }
}

unsafe fn handle_automation_copydata(state: &mut AppState, lparam: LPARAM) -> LRESULT {
    if !state.automation_enabled || lparam == 0 {
        return 0;
    }
    let copy = &*(lparam as *const COPYDATASTRUCT);
    if copy.dwData != AUTOMATION_COPYDATA_ID || copy.lpData.is_null() || copy.cbData == 0 {
        return 0;
    }
    let bytes = std::slice::from_raw_parts(copy.lpData.cast::<u8>(), copy.cbData as usize);
    let Ok(command) = serde_json::from_slice::<AutomationCommand>(bytes) else {
        return 0;
    };
    match command.control_id {
        ID_WORKSPACE | ID_PROJECT | ID_ASSET | ID_EVENT_TYPE | ID_EVENT_PAYLOAD
        | ID_SEAL_OUTPUT | ID_PACKAGE => {
            set_text(item(state, command.control_id), &command.value);
            1
        }
        ID_ROLE => {
            let index = match command.value.as_str() {
                "input" => 0,
                "output" => 1,
                "reference" => 2,
                "license" => 3,
                "other" => 4,
                _ => return 0,
            };
            SendMessageW(item(state, ID_ROLE), CB_SETCURSEL, index, 0);
            1
        }
        9001 => {
            state.automation_report_path = Some(PathBuf::from(command.value));
            1
        }
        _ => 0,
    }
}

unsafe fn create_controls(state: &mut AppState) {
    unsafe {
        state.font = CreateFontW(
            -17,
            0,
            0,
            0,
            400,
            0,
            0,
            0,
            DEFAULT_CHARSET as u32,
            0,
            0,
            5,
            0,
            wide("Microsoft YaHei UI").as_ptr(),
        );
        label(
            state,
            24,
            18,
            720,
            30,
            "AIGC-Proof 0.2 — 包内完整性桌面预览",
            true,
        );
        label(
            state,
            760,
            18,
            480,
            58,
            "能力边界：仅证明包内完整性。\r\n不验证身份、签名、可信时间、原创性、版权或权属。",
            false,
        );

        group(state, 18, 62, 710, 170, "1  创建 / 打开工作区");
        label(state, 34, 92, 90, 24, "工作区", false);
        edit(state, ID_WORKSPACE, 118, 88, 480, 27, "");
        button(state, ID_BROWSE_WORKSPACE, 608, 87, 100, 29, "选择文件夹");
        label(state, 34, 126, 90, 24, "项目名", false);
        edit(state, ID_PROJECT, 118, 122, 340, 27, "");
        button(
            state,
            ID_INIT_OPEN,
            468,
            121,
            240,
            29,
            "初始化 / 打开工作区",
        );
        label(state, 34, 163, 90, 24, "最近工作区", false);
        combo(state, ID_RECENT_WORKSPACE, 118, 159, 480, 150);
        button(state, ID_REOPEN_WORKSPACE, 608, 158, 100, 29, "重新打开");
        label(
            state,
            34,
            195,
            660,
            24,
            "初始化不会覆盖现有路径；打开会验证工作区结构。",
            false,
        );

        group(state, 18, 240, 710, 122, "2  添加资产");
        label(state, 34, 271, 90, 24, "资产文件", false);
        edit(state, ID_ASSET, 118, 267, 480, 27, "");
        button(state, ID_BROWSE_ASSET, 608, 266, 100, 29, "选择文件");
        label(state, 34, 307, 90, 24, "角色", false);
        combo(state, ID_ROLE, 118, 303, 180, 150);
        for role in ["input", "output", "reference", "license", "other"] {
            combo_add(item(state, ID_ROLE), role);
        }
        SendMessageW(item(state, ID_ROLE), CB_SETCURSEL, 0, 0);
        button(state, ID_ADD_ASSET, 468, 302, 240, 29, "添加到工作区");

        group(state, 18, 370, 710, 162, "3  记录事件");
        label(state, 34, 401, 90, 24, "事件类型", false);
        edit(state, ID_EVENT_TYPE, 118, 397, 340, 27, "generation");
        button(state, ID_RECORD_EVENT, 468, 396, 240, 29, "记录事件");
        label(state, 34, 437, 90, 24, "JSON 载荷", false);
        edit_multiline(
            state,
            ID_EVENT_PAYLOAD,
            118,
            433,
            590,
            82,
            "{\r\n  \"model\": \"demo-model\"\r\n}",
            false,
        );

        group(state, 18, 540, 710, 112, "4  封装证明包");
        label(state, 34, 572, 90, 24, "输出文件", false);
        edit(state, ID_SEAL_OUTPUT, 118, 568, 480, 27, "");
        button(state, ID_BROWSE_SEAL, 608, 567, 100, 29, "选择位置");
        button(state, ID_SEAL, 468, 607, 240, 29, "封装 .aigcproof");

        group(state, 18, 660, 710, 142, "5  验证 / 检查证明包");
        label(state, 34, 692, 90, 24, "证明包", false);
        edit(state, ID_PACKAGE, 118, 688, 480, 27, "");
        button(state, ID_BROWSE_PACKAGE, 608, 687, 100, 29, "选择文件");
        button(state, ID_VERIFY, 118, 724, 180, 29, "验证证明包");
        button(state, ID_INSPECT, 308, 724, 150, 29, "仅检查元数据");
        button(state, ID_SAVE_REPORT, 468, 724, 240, 29, "保存最近验证报告");
        combo(state, ID_RECENT_PACKAGE, 118, 761, 480, 120);
        button(state, ID_REOPEN_PACKAGE, 608, 760, 100, 29, "最近包");

        group(state, 742, 84, 510, 718, "结果与保证说明");
        state.status = label(state, 760, 112, 470, 24, "就绪", false);
        SetWindowLongPtrW(state.status, GWLP_ID, ID_STATUS as isize);
        state.progress = CreateWindowExW(
            0,
            PROGRESS_CLASSW,
            null(),
            WS_CHILD | WS_VISIBLE | PBS_MARQUEE,
            760,
            142,
            470,
            12,
            state.hwnd,
            null_mut(),
            GetModuleHandleW(null()),
            null(),
        );
        state.result = edit_multiline(
            state,
            ID_RESULT,
            760,
            170,
            470,
            610,
            "欢迎使用 AIGC-Proof Desktop Preview。\r\n\r\n按左侧顺序完成工作区、资产、事件、封装和验证。\r\n所有操作均在本地离线执行。",
            true,
        );
        set_font(state, state.progress);
        refresh_recent_controls(state);
    }
}

unsafe fn handle_command(state: &mut AppState, id: i32) {
    unsafe {
        if state.busy && ACTION_IDS.contains(&id) {
            return;
        }
        match id {
            ID_BROWSE_WORKSPACE => {
                if let Some(path) = choose_folder(state.hwnd) {
                    set_text(item(state, ID_WORKSPACE), &path.to_string_lossy());
                }
            }
            ID_BROWSE_ASSET => {
                if let Some(path) =
                    choose_open_file(state.hwnd, "选择资产文件", &all_files_filter())
                {
                    set_text(item(state, ID_ASSET), &path.to_string_lossy());
                }
            }
            ID_BROWSE_SEAL => {
                if let Some(path) = choose_save_file(
                    state.hwnd,
                    "保存 AIGC-Proof 证明包",
                    &package_filter(),
                    "aigcproof",
                ) {
                    set_text(item(state, ID_SEAL_OUTPUT), &path.to_string_lossy());
                }
            }
            ID_BROWSE_PACKAGE => {
                if let Some(path) =
                    choose_open_file(state.hwnd, "选择 AIGC-Proof 证明包", &package_filter())
                {
                    set_text(item(state, ID_PACKAGE), &path.to_string_lossy());
                }
            }
            ID_REOPEN_WORKSPACE => {
                if let Some(value) = combo_selected(item(state, ID_RECENT_WORKSPACE)) {
                    set_text(item(state, ID_WORKSPACE), &value);
                    start_open_workspace(state, PathBuf::from(value), None);
                }
            }
            ID_REOPEN_PACKAGE => {
                if let Some(value) = combo_selected(item(state, ID_RECENT_PACKAGE)) {
                    set_text(item(state, ID_PACKAGE), &value);
                }
            }
            ID_INIT_OPEN => {
                let path = PathBuf::from(get_text(item(state, ID_WORKSPACE)).trim());
                let project = nonempty(get_text(item(state, ID_PROJECT)));
                start_open_workspace(state, path, project);
            }
            ID_ADD_ASSET => start_add_asset(state),
            ID_RECORD_EVENT => start_record_event(state),
            ID_SEAL => start_seal(state),
            ID_VERIFY => start_verify(state),
            ID_INSPECT => start_inspect(state),
            ID_SAVE_REPORT => save_report(state),
            _ => {}
        }
    }
}

unsafe fn start_open_workspace(state: &mut AppState, path: PathBuf, project: Option<String>) {
    if path.as_os_str().is_empty() {
        set_result(state, "请选择工作区路径。", true);
        return;
    }
    begin_operation(state, "正在初始化 / 打开工作区…", move || {
        let workspace = if path.exists() {
            load_workspace(&path)
        } else {
            init_workspace(InitWorkspaceOptions {
                path: path.clone(),
                project_name: project,
                created_at: current_timestamp()?,
            })
        }?;
        let mut result = OperationResult::ok(format!(
            "工作区已就绪\r\n\r\n路径：{}\r\n项目：{}\r\n资产：{} 个\r\n\r\n该操作只建立或验证本地工作区，不上传任何内容。",
            path.display(),
            workspace.project.name.as_deref().unwrap_or("未命名"),
            workspace.assets.len()
        ));
        result.recent_workspace = Some(path);
        Ok(result)
    });
}

unsafe fn start_add_asset(state: &mut AppState) {
    let workspace = PathBuf::from(get_text(item(state, ID_WORKSPACE)).trim());
    let source = PathBuf::from(get_text(item(state, ID_ASSET)).trim());
    let role = combo_selected(item(state, ID_ROLE)).unwrap_or_else(|| "input".to_owned());
    begin_operation(state, "正在流式复制并计算 SHA-256…", move || {
        let role = AssetRole::from_str(&role).map_err(simple_error)?;
        let media_type = media_type_for_path(&source).to_owned();
        let asset = add_asset(AddAssetOptions {
            workspace: workspace.clone(),
            source,
            role,
            asset_id: Uuid::new_v4().to_string(),
            media_type,
        })?;
        let mut result = OperationResult::ok(format!(
            "资产添加成功\r\n\r\n角色：{}\r\n文件：{}\r\n大小：{} 字节\r\nSHA-256：{}",
            asset.role, asset.original_name, asset.size_bytes, asset.sha256
        ));
        result.recent_workspace = Some(workspace);
        Ok(result)
    });
}

unsafe fn start_record_event(state: &mut AppState) {
    let workspace = PathBuf::from(get_text(item(state, ID_WORKSPACE)).trim());
    let event_type = get_text(item(state, ID_EVENT_TYPE)).trim().to_owned();
    let payload_text = get_text(item(state, ID_EVENT_PAYLOAD));
    begin_operation(
        state,
        "正在规范化 JSON 并追加事件哈希链…",
        move || {
            let payload: Value =
                parse_json_strict(payload_text.as_bytes()).map_err(simple_error)?;
            let event = record_event(RecordEventOptions {
                workspace: workspace.clone(),
                event_id: Uuid::new_v4().to_string(),
                event_type,
                created_at: current_timestamp()?,
                payload,
            })?;
            let mut result = OperationResult::ok(format!(
                "事件记录成功\r\n\r\n序号：{}\r\n类型：{}\r\n事件哈希：{}\r\n前序哈希：{}",
                event.sequence,
                event.event_type,
                event.event_hash,
                event
                    .previous_event_hash
                    .as_deref()
                    .unwrap_or("无（首个事件）")
            ));
            result.recent_workspace = Some(workspace);
            Ok(result)
        },
    );
}

unsafe fn start_seal(state: &mut AppState) {
    let workspace = PathBuf::from(get_text(item(state, ID_WORKSPACE)).trim());
    let output = PathBuf::from(get_text(item(state, ID_SEAL_OUTPUT)).trim());
    begin_operation(
        state,
        "正在校验工作区并封装证明包…",
        move || {
            let sealed = seal_workspace(SealOptions {
                workspace: workspace.clone(),
                output: output.clone(),
                proof_id: format!("urn:uuid:{}", Uuid::new_v4()),
                created_at: current_timestamp()?,
            })?;
            let mut result = OperationResult::ok(format!(
                "封装成功\r\n\r\n证明 ID：{}\r\n输出：{}\r\n资产：{} 个\r\n事件：{} 个\r\n\r\n输出路径已采用禁止覆盖语义。",
                sealed.manifest.proof_id,
                sealed.path.display(),
                sealed.manifest.assets.len(),
                sealed.manifest.event_chain.event_count
            ));
            result.recent_workspace = Some(workspace);
            result.recent_package = Some(output);
            Ok(result)
        },
    );
}

unsafe fn start_verify(state: &mut AppState) {
    let package = PathBuf::from(get_text(item(state, ID_PACKAGE)).trim());
    begin_operation(
        state,
        "正在安全读取 ZIP 并验证包内完整性…",
        move || {
            let report = verify_package(
                &package,
                &VerificationLimits::default(),
                current_timestamp()?,
            );
            let report_bytes = serde_json::to_vec_pretty(&report).map_err(simple_error)?;
            let mut result = OperationResult::ok(format_verification(&report));
            result.recent_package = Some(package);
            result.report = Some(report_bytes);
            Ok(result)
        },
    );
}

unsafe fn start_inspect(state: &mut AppState) {
    let package = PathBuf::from(get_text(item(state, ID_PACKAGE)).trim());
    begin_operation(
        state,
        "正在安全读取元数据（不会替代验证）…",
        move || {
            let inspection = inspect_package(&package, &VerificationLimits::default())?;
            let mut result = OperationResult::ok(format_inspection(&inspection));
            result.recent_package = Some(package);
            Ok(result)
        },
    );
}

unsafe fn save_report(state: &mut AppState) {
    let Some(bytes) = state.last_report.as_deref() else {
        set_result(state, "尚无验证报告。请先验证证明包。", true);
        return;
    };
    let path = if state.automation_enabled {
        match state.automation_report_path.take() {
            Some(path) => path,
            None => {
                set_result(state, "自动化报告路径未设置。", true);
                return;
            }
        }
    } else {
        let Some(path) = choose_save_file(state.hwnd, "保存验证报告", &json_filter(), "json")
        else {
            return;
        };
        path
    };
    match save_report_no_clobber(&path, bytes) {
        Ok(()) => set_result(
            state,
            &format!(
                "验证报告已保存\r\n\r\n{}\r\n\r\n不会覆盖已有文件。",
                path.display()
            ),
            false,
        ),
        Err(error) => set_result(state, &error, true),
    }
}

unsafe fn begin_operation<F>(state: &mut AppState, status: &str, operation: F)
where
    F: FnOnce() -> Result<OperationResult, proof_core::CoreError> + Send + 'static,
{
    unsafe {
        state.busy = true;
        set_text(state.status, status);
        SendMessageW(state.progress, PBM_SETMARQUEE, 1, 30);
        for id in ACTION_IDS {
            EnableWindow(item(state, *id), 0);
        }
        let hwnd_value = state.hwnd as usize;
        thread::spawn(move || {
            let result = operation().unwrap_or_else(OperationResult::error);
            let result_ptr = Box::into_raw(Box::new(result));
            PostMessageW(
                hwnd_value as HWND,
                WM_OPERATION_COMPLETE,
                0,
                result_ptr as LPARAM,
            );
        });
    }
}

unsafe fn finish_operation(state: &mut AppState, result: OperationResult) {
    unsafe {
        state.busy = false;
        SendMessageW(state.progress, PBM_SETMARQUEE, 0, 0);
        set_text(
            state.status,
            if result.is_error {
                "操作失败"
            } else {
                "操作完成"
            },
        );
        for id in ACTION_IDS {
            EnableWindow(item(state, *id), 1);
        }
        set_result(state, &result.text, result.is_error);
        if let Some(path) = result.recent_workspace {
            state.recent.remember_workspace(path);
        }
        if let Some(path) = result.recent_package {
            state.recent.remember_package(path.clone());
            set_text(item(state, ID_PACKAGE), &path.to_string_lossy());
        }
        if let Some(report) = result.report {
            state.last_report = Some(report);
        }
        let _ = save_recent_state(&state.state_path, &state.recent);
        refresh_recent_controls(state);
    }
}

unsafe fn set_result(state: &AppState, text: &str, is_error: bool) {
    let prefix = if is_error { "⚠ " } else { "" };
    set_text(state.result, &format!("{prefix}{text}"));
}

unsafe fn refresh_recent_controls(state: &AppState) {
    unsafe {
        let workspace_combo = item(state, ID_RECENT_WORKSPACE);
        SendMessageW(workspace_combo, CB_RESETCONTENT, 0, 0);
        for path in &state.recent.workspaces {
            combo_add(workspace_combo, &path.to_string_lossy());
        }
        if !state.recent.workspaces.is_empty() {
            SendMessageW(workspace_combo, CB_SETCURSEL, 0, 0);
        }
        let package_combo = item(state, ID_RECENT_PACKAGE);
        SendMessageW(package_combo, CB_RESETCONTENT, 0, 0);
        for path in &state.recent.packages {
            combo_add(package_combo, &path.to_string_lossy());
        }
        if !state.recent.packages.is_empty() {
            SendMessageW(package_combo, CB_SETCURSEL, 0, 0);
        }
    }
}

unsafe fn choose_folder(owner: HWND) -> Option<PathBuf> {
    unsafe {
        let mut display = [0_u16; 260];
        let title = wide("选择工作区目录的父目录，或选择已有工作区");
        let browse = BROWSEINFOW {
            hwndOwner: owner,
            pidlRoot: null_mut(),
            pszDisplayName: display.as_mut_ptr(),
            lpszTitle: title.as_ptr(),
            ulFlags: BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE,
            lpfn: None,
            lParam: 0,
            iImage: 0,
        };
        let item_id = SHBrowseForFolderW(&browse);
        if item_id.is_null() {
            return None;
        }
        let mut path = [0_u16; 32768];
        let ok = SHGetPathFromIDListW(item_id, path.as_mut_ptr());
        CoTaskMemFree(item_id.cast::<c_void>());
        if ok == 0 {
            None
        } else {
            Some(PathBuf::from(String::from_utf16_lossy(
                &path[..path
                    .iter()
                    .position(|value| *value == 0)
                    .unwrap_or(path.len())],
            )))
        }
    }
}

unsafe fn choose_open_file(owner: HWND, title: &str, filter: &[u16]) -> Option<PathBuf> {
    choose_file(owner, title, filter, None, false)
}

unsafe fn choose_save_file(
    owner: HWND,
    title: &str,
    filter: &[u16],
    extension: &str,
) -> Option<PathBuf> {
    choose_file(owner, title, filter, Some(extension), true)
}

unsafe fn choose_file(
    owner: HWND,
    title: &str,
    filter: &[u16],
    extension: Option<&str>,
    save: bool,
) -> Option<PathBuf> {
    unsafe {
        let mut path = [0_u16; 32768];
        let title = wide(title);
        let extension = extension.map(wide);
        let mut dialog: OPENFILENAMEW = zeroed();
        dialog.lStructSize = size_of::<OPENFILENAMEW>() as u32;
        dialog.hwndOwner = owner;
        dialog.lpstrFilter = filter.as_ptr();
        dialog.lpstrFile = path.as_mut_ptr();
        dialog.nMaxFile = path.len() as u32;
        dialog.lpstrTitle = title.as_ptr();
        dialog.lpstrDefExt = extension.as_ref().map_or(null(), |value| value.as_ptr());
        dialog.Flags = OFN_EXPLORER | OFN_PATHMUSTEXIST;
        if save {
            dialog.Flags |= OFN_OVERWRITEPROMPT;
        } else {
            dialog.Flags |= OFN_FILEMUSTEXIST;
        }
        let chosen = if save {
            GetSaveFileNameW(&mut dialog)
        } else {
            GetOpenFileNameW(&mut dialog)
        };
        if chosen == 0 {
            None
        } else {
            Some(PathBuf::from(String::from_utf16_lossy(
                &path[..path
                    .iter()
                    .position(|value| *value == 0)
                    .unwrap_or(path.len())],
            )))
        }
    }
}

unsafe fn group(state: &AppState, x: i32, y: i32, width: i32, height: i32, text: &str) -> HWND {
    create_control(
        state,
        "BUTTON",
        text,
        WS_CHILD | WS_VISIBLE | BS_GROUPBOX as u32,
        0,
        x,
        y,
        width,
        height,
        0,
    )
}

unsafe fn label(
    state: &AppState,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    text: &str,
    heading: bool,
) -> HWND {
    let style = if heading {
        SS_LEFT | SS_CENTERIMAGE
    } else {
        SS_LEFT
    };
    create_control(
        state,
        "STATIC",
        text,
        WS_CHILD | WS_VISIBLE | style,
        0,
        x,
        y,
        width,
        height,
        0,
    )
}

unsafe fn edit(
    state: &AppState,
    id: i32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    text: &str,
) -> HWND {
    create_control(
        state,
        "EDIT",
        text,
        WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL as u32,
        WS_EX_CLIENTEDGE,
        x,
        y,
        width,
        height,
        id,
    )
}

unsafe fn edit_multiline(
    state: &AppState,
    id: i32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    text: &str,
    readonly: bool,
) -> HWND {
    unsafe {
        let hwnd = create_control(
            state,
            "EDIT",
            text,
            WS_CHILD
                | WS_VISIBLE
                | WS_TABSTOP
                | WS_VSCROLL
                | ES_MULTILINE as u32
                | ES_AUTOVSCROLL as u32,
            WS_EX_CLIENTEDGE,
            x,
            y,
            width,
            height,
            id,
        );
        if readonly {
            SendMessageW(hwnd, EM_SETREADONLY, 1, 0);
        }
        hwnd
    }
}

unsafe fn button(
    state: &AppState,
    id: i32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    text: &str,
) -> HWND {
    create_control(
        state,
        "BUTTON",
        text,
        WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON as u32,
        0,
        x,
        y,
        width,
        height,
        id,
    )
}

unsafe fn combo(state: &AppState, id: i32, x: i32, y: i32, width: i32, height: i32) -> HWND {
    create_control(
        state,
        "COMBOBOX",
        "",
        WS_CHILD | WS_VISIBLE | WS_TABSTOP | WS_VSCROLL | CBS_DROPDOWNLIST as u32,
        0,
        x,
        y,
        width,
        height,
        id,
    )
}

#[allow(clippy::too_many_arguments)]
unsafe fn create_control(
    state: &AppState,
    class: &str,
    text: &str,
    style: u32,
    ex_style: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    id: i32,
) -> HWND {
    unsafe {
        let class = wide(class);
        let text = wide(text);
        let hwnd = CreateWindowExW(
            ex_style,
            class.as_ptr(),
            text.as_ptr(),
            style,
            x,
            y,
            width,
            height,
            state.hwnd,
            id as usize as _,
            GetModuleHandleW(null()),
            null(),
        );
        set_font(state, hwnd);
        hwnd
    }
}

unsafe fn set_font(state: &AppState, hwnd: HWND) {
    unsafe {
        if !hwnd.is_null() && !state.font.is_null() {
            SendMessageW(hwnd, WM_SETFONT, state.font as usize, 1);
        }
    }
}

unsafe fn item(state: &AppState, id: i32) -> HWND {
    unsafe { GetDlgItem(state.hwnd, id) }
}

unsafe fn get_text(hwnd: HWND) -> String {
    unsafe {
        let length = SendMessageW(hwnd, WM_GETTEXTLENGTH, 0, 0).max(0) as usize;
        let mut buffer = vec![0_u16; length + 1];
        let copied = SendMessageW(
            hwnd,
            WM_GETTEXT,
            buffer.len(),
            buffer.as_mut_ptr() as LPARAM,
        )
        .max(0) as usize;
        String::from_utf16_lossy(&buffer[..copied.min(length)])
    }
}

unsafe fn set_text(hwnd: HWND, text: &str) {
    unsafe {
        let value = wide(text);
        SetWindowTextW(hwnd, value.as_ptr());
    }
}

unsafe fn combo_add(hwnd: HWND, value: &str) {
    unsafe {
        let value = wide(value);
        SendMessageW(hwnd, CB_ADDSTRING, 0, value.as_ptr() as LPARAM);
    }
}

unsafe fn combo_selected(hwnd: HWND) -> Option<String> {
    unsafe {
        let index = SendMessageW(hwnd, CB_GETCURSEL, 0, 0);
        if index < 0 {
            return None;
        }
        let length = SendMessageW(hwnd, CB_GETLBTEXTLEN, index as usize, 0);
        if length < 0 {
            return None;
        }
        let mut buffer = vec![0_u16; length as usize + 1];
        SendMessageW(
            hwnd,
            CB_GETLBTEXT,
            index as usize,
            buffer.as_mut_ptr() as LPARAM,
        );
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

fn local_state_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("AIGC-Proof")
        .join("desktop-state.json")
}

fn nonempty(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn package_filter() -> Vec<u16> {
    filter(&[
        ("AIGC-Proof 证明包 (*.aigcproof)", "*.aigcproof"),
        ("所有文件 (*.*)", "*.*"),
    ])
}

fn json_filter() -> Vec<u16> {
    filter(&[("JSON 报告 (*.json)", "*.json"), ("所有文件 (*.*)", "*.*")])
}

fn all_files_filter() -> Vec<u16> {
    filter(&[("所有文件 (*.*)", "*.*")])
}

fn filter(items: &[(&str, &str)]) -> Vec<u16> {
    let mut value = Vec::new();
    for (name, pattern) in items {
        value.extend(name.encode_utf16());
        value.push(0);
        value.extend(pattern.encode_utf16());
        value.push(0);
    }
    value.push(0);
    value
}

fn simple_error(error: impl std::fmt::Display) -> proof_core::CoreError {
    proof_core::CoreError::new(
        proof_core::ErrorKind::MalformedJson,
        "DESKTOP_INPUT_INVALID",
        error.to_string(),
    )
}
