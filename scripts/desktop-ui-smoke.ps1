[CmdletBinding()]
param(
    [string]$Executable,
    [string]$EvidenceDirectory
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Executable)) {
    $Executable = Join-Path (Split-Path -Parent $repo) "app\AIGC-Proof-Desktop-Preview\AIGC-Proof.exe"
}
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Packaged desktop executable was not found: $Executable"
}
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    $EvidenceDirectory = Join-Path $env:TEMP ("aigc-proof-desktop-ui-" + [guid]::NewGuid().ToString("N"))
}
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$progressLog = Join-Path $EvidenceDirectory "progress.log"
function Write-ProgressLog {
    param([string]$Message)
    [System.IO.File]::AppendAllText(
        $script:progressLog,
        ([DateTime]::UtcNow.ToString("O") + " " + $Message + [Environment]::NewLine),
        [System.Text.UTF8Encoding]::new($false)
    )
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class AigcProofNative {
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowW(string className, string windowName);
    [DllImport("user32.dll")]
    public static extern IntPtr GetDlgItem(IntPtr window, int id);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool SetWindowTextW(IntPtr window, string text);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLengthW(IntPtr window);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTextW(IntPtr window, uint message, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")]
    public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr window, IntPtr targetDeviceContext, uint flags);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }
    [StructLayout(LayoutKind.Explicit, Size = 32)]
    private struct INPUTUNION {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT {
        public uint type;
        public INPUTUNION data;
    }
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint first, uint second, bool attach);
    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    public static void ForceFocus(IntPtr owner, IntPtr control) {
        uint processId;
        uint targetThread = GetWindowThreadProcessId(owner, out processId);
        uint currentThread = GetCurrentThreadId();
        bool attached = targetThread != 0 && targetThread != currentThread && AttachThreadInput(currentThread, targetThread, true);
        try {
            ShowWindow(owner, 9);
            SetForegroundWindow(owner);
            SetFocus(control);
        } finally {
            if (attached) AttachThreadInput(currentThread, targetThread, false);
        }
    }

    public static void SelectAllAndType(string value) {
        keybd_event(0x11, 0, 0, UIntPtr.Zero);
        keybd_event(0x41, 0, 0, UIntPtr.Zero);
        keybd_event(0x41, 0, 2, UIntPtr.Zero);
        keybd_event(0x11, 0, 2, UIntPtr.Zero);
        foreach (char character in value) {
            INPUT down = new INPUT();
            down.type = 1;
            down.data.keyboard.scanCode = character;
            down.data.keyboard.flags = 0x0004;
            INPUT up = down;
            up.data.keyboard.flags = 0x0004 | 0x0002;
            INPUT[] pair = new INPUT[] { down, up };
            if (SendInput(2, pair, Marshal.SizeOf(typeof(INPUT))) != 2) {
                throw new InvalidOperationException("SendInput failed.");
            }
        }
    }

    public static IntPtr FindWindowForProcess(uint expectedProcessId) {
        IntPtr match = IntPtr.Zero;
        EnumWindows(delegate(IntPtr candidate, IntPtr parameter) {
            uint processId;
            GetWindowThreadProcessId(candidate, out processId);
            if (processId == expectedProcessId && IsWindowVisible(candidate)) {
                int length = GetWindowTextLengthW(candidate);
                StringBuilder title = new StringBuilder(length + 1);
                GetWindowTextW(candidate, title, title.Capacity);
                if (title.ToString().StartsWith("AIGC-Proof Desktop Preview", StringComparison.Ordinal)) {
                    match = candidate;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return match;
    }

    public static string GetControlText(IntPtr control) {
        const uint WM_GETTEXT = 0x000D;
        const uint WM_GETTEXTLENGTH = 0x000E;
        int length = SendMessageW(control, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero).ToInt32();
        StringBuilder text = new StringBuilder(length + 1);
        SendMessageTextW(control, WM_GETTEXT, new IntPtr(text.Capacity), text);
        return text.ToString();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct COPYDATASTRUCT {
        public UIntPtr dataId;
        public uint byteCount;
        public IntPtr data;
    }

    public static bool SendAutomationValue(IntPtr owner, string json) {
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        IntPtr data = Marshal.AllocHGlobal(bytes.Length);
        IntPtr structure = IntPtr.Zero;
        try {
            Marshal.Copy(bytes, 0, data, bytes.Length);
            COPYDATASTRUCT copy = new COPYDATASTRUCT();
            copy.dataId = new UIntPtr(0xA1C00200);
            copy.byteCount = (uint)bytes.Length;
            copy.data = data;
            structure = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(COPYDATASTRUCT)));
            Marshal.StructureToPtr(copy, structure, false);
            UIntPtr result;
            IntPtr sent = SendMessageTimeoutW(owner, 0x004A, IntPtr.Zero, structure, 0x0002, 10000, out result);
            return sent != IntPtr.Zero && result != UIntPtr.Zero;
        } finally {
            if (structure != IntPtr.Zero) Marshal.FreeHGlobal(structure);
            Marshal.FreeHGlobal(data);
        }
    }
}
"@

$BM_CLICK = 0x00F5
$CB_SETCURSEL = 0x014E
$WM_CLOSE = 0x0010
$WM_COMMAND = 0x0111

function Wait-Until {
    param([scriptblock]$Condition, [string]$Description, [int]$Seconds = 30)
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    $lastError = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            if (& $Condition) { return }
            $lastError = $null
        } catch {
            $lastError = $_.Exception.Message
        }
        if ($process.HasExited) {
            throw "The packaged desktop process exited while waiting for $Description (exit code $($process.ExitCode))."
        }
        Start-Sleep -Milliseconds 200
    }
    $diagnostic = if ($null -eq $lastError) { "" } else { " Last observation error: $lastError" }
    throw "Timed out after $Seconds seconds waiting for $Description.$diagnostic"
}

function Get-ControlText {
    param([IntPtr]$Control)
    [AigcProofNative]::GetControlText($Control)
}

function Find-Control {
    param([int]$Id)
    if ($script:window -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    [AigcProofNative]::GetDlgItem($script:window, $Id)
}

function Get-Control {
    param([int]$Id)
    $control = Find-Control $Id
    if ($control -eq [IntPtr]::Zero) { throw "Desktop control $Id was not found." }
    $control
}

function Set-ControlText {
    param([int]$Id, [string]$Value)
    $json = @{ control_id = $Id; value = $Value } | ConvertTo-Json -Compress
    if (-not [AigcProofNative]::SendAutomationValue($script:window, $json)) {
        throw "The packaged UI rejected automation input for control $Id."
    }
    if ($Id -eq 9001) { return }
    Wait-Until -Description "desktop control $Id input" -Seconds 10 -Condition {
        (Get-ControlText (Get-Control $Id)) -eq $Value
    }
}

function Focus-WindowControl {
    param([IntPtr]$Control, [IntPtr]$Owner)
    $rect = New-Object AigcProofNative+RECT
    if (-not [AigcProofNative]::GetWindowRect($Control, [ref]$rect)) {
        throw "Failed to read control bounds."
    }
    [AigcProofNative]::ForceFocus($Owner, $Control)
    [void][AigcProofNative]::SetCursorPos(
        [int](($rect.Left + $rect.Right) / 2),
        [int](($rect.Top + $rect.Bottom) / 2)
    )
    [AigcProofNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [AigcProofNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
}

function Click-WindowControl {
    param([IntPtr]$Control, [IntPtr]$Owner)
    $element = [System.Windows.Automation.AutomationElement]::FromHandle($Control)
    if ($null -ne $element) {
        try {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $pattern.Invoke()
            return
        } catch {
            # Fall back to a real pointer click for native controls without an Invoke provider.
        }
    }
    Focus-WindowControl $Control $Owner
}

function Invoke-DesktopAction {
    param([int]$Id, [string]$Expected, [string]$Description)
    $resultControl = Get-Control 202
    $before = Get-ControlText $resultControl
    if (-not [AigcProofNative]::PostMessageW($script:window, $WM_COMMAND, [IntPtr]$Id, [IntPtr]::Zero)) {
        throw "Failed to dispatch desktop action $Id."
    }
    Wait-Until -Description "$Description result" -Seconds 120 -Condition {
        $current = Get-ControlText $resultControl
        $status = Get-ControlText (Get-Control 201)
        ($status -eq "操作完成" -or $status -eq "操作失败") -and
            ($current -ne $before -or $current -like "*$Expected*")
    }
    $result = Get-ControlText $resultControl
    if ($result -notlike "*$Expected*") {
        throw "$Description returned an unexpected result: $result"
    }
    $result
}

function Save-WindowScreenshot {
    param([string]$Path)
    Add-Type -AssemblyName System.Drawing
    $rect = New-Object AigcProofNative+RECT
    if (-not [AigcProofNative]::GetWindowRect($script:window, [ref]$rect)) {
        throw "Failed to read the desktop window bounds."
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $deviceContext = $graphics.GetHdc()
        try {
            if (-not [AigcProofNative]::PrintWindow($script:window, $deviceContext, 2)) {
                throw "PrintWindow failed to render the desktop window."
            }
        } finally {
            $graphics.ReleaseHdc($deviceContext)
        }
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$workspace = Join-Path $EvidenceDirectory "workspace"
$input = Join-Path $EvidenceDirectory "input.txt"
$output = Join-Path $EvidenceDirectory "output.txt"
$package = Join-Path $EvidenceDirectory "valid.aigcproof"
$tampered = Join-Path $EvidenceDirectory "tampered.aigcproof"
$report = Join-Path $EvidenceDirectory "verification-report.json"
$screenshot = Join-Path $EvidenceDirectory "tampered-rejection.png"
[System.IO.File]::WriteAllText($input, "desktop input", [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($output, "desktop output", [System.Text.UTF8Encoding]::new($false))

$process = Start-Process -FilePath $Executable -ArgumentList "--automation" -PassThru
Write-ProgressLog ("started pid=" + $process.Id)
try {
    $script:window = [IntPtr]::Zero
    Wait-Until -Description "packaged desktop window" -Seconds 60 -Condition {
        $process.Refresh()
        $script:window = [AigcProofNative]::FindWindowForProcess([uint32]$process.Id)
        $script:window.ToInt64() -ne 0
    }
    Write-ProgressLog ("window=" + $script:window)
    Wait-Until -Description "desktop controls" -Seconds 30 -Condition {
        (Find-Control 101) -ne [IntPtr]::Zero -and
            (Find-Control 201) -ne [IntPtr]::Zero -and
            (Find-Control 202) -ne [IntPtr]::Zero
    }
    Write-ProgressLog "controls-ready"
    Save-WindowScreenshot (Join-Path $EvidenceDirectory "startup.png")

    Set-ControlText 101 $workspace
    Set-ControlText 103 "AP-005 Desktop Acceptance"
    $initResult = Invoke-DesktopAction 104 "工作区已就绪" "workspace initialization"
    Write-ProgressLog "init-pass"

    Set-ControlText 111 $input
    Set-ControlText 113 "input"
    $inputResult = Invoke-DesktopAction 114 "资产添加成功" "input asset add"
    Write-ProgressLog "input-pass"

    Set-ControlText 111 $output
    Set-ControlText 113 "output"
    $outputResult = Invoke-DesktopAction 114 "资产添加成功" "output asset add"
    Write-ProgressLog "output-pass"

    Set-ControlText 121 "generation"
    Set-ControlText 122 '{"model":"desktop-acceptance","prompt":"local-only"}'
    $eventResult = Invoke-DesktopAction 123 "事件记录成功" "event record"
    Write-ProgressLog "event-pass"

    Set-ControlText 131 $package
    $sealResult = Invoke-DesktopAction 133 "封装成功" "package seal"
    Write-ProgressLog "seal-pass"
    if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { throw "The packaged UI did not create the proof package." }

    Set-ControlText 141 $package
    $verifyResult = Invoke-DesktopAction 143 "valid（有效）" "valid package verification"
    Write-ProgressLog "verify-pass"

    Set-ControlText 9001 $report
    [void][AigcProofNative]::PostMessageW($script:window, $WM_COMMAND, [IntPtr]145, [IntPtr]::Zero)
    Wait-Until -Description "persisted verification report" -Condition { Test-Path -LiteralPath $report -PathType Leaf }

    $inspectionResult = Invoke-DesktopAction 144 "未执行完整性验证" "package inspection"

    [void][AigcProofNative]::SendMessageW((Get-Control 105), $CB_SETCURSEL, [IntPtr]::Zero, [IntPtr]::Zero)
    $reopenWorkspaceResult = Invoke-DesktopAction 106 "工作区已就绪" "recent workspace reopen"
    [void][AigcProofNative]::SendMessageW((Get-Control 146), $CB_SETCURSEL, [IntPtr]::Zero, [IntPtr]::Zero)
    [void][AigcProofNative]::PostMessageW($script:window, $WM_COMMAND, [IntPtr]147, [IntPtr]::Zero)
    if ((Get-ControlText (Get-Control 141)) -ne $package) { throw "Recent package reopen did not restore the package path." }

    Copy-Item -LiteralPath $package -Destination $tampered
    Add-Type -AssemblyName System.IO.Compression
    $fileStream = [System.IO.File]::Open($tampered, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $archive = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Update, $false)
        try {
            $assetEntry = $archive.Entries | Where-Object { $_.FullName.StartsWith("assets/") } | Select-Object -First 1
            if ($null -eq $assetEntry) { throw "No asset entry was found for tampering." }
            $entryName = $assetEntry.FullName
            $readStream = $assetEntry.Open()
            try {
                $memory = New-Object System.IO.MemoryStream
                $readStream.CopyTo($memory)
                $bytes = $memory.ToArray()
            } finally {
                $readStream.Dispose()
            }
            $bytes[0] = $bytes[0] -bxor 0x01
            $assetEntry.Delete()
            $replacement = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $writeStream = $replacement.Open()
            try { $writeStream.Write($bytes, 0, $bytes.Length) } finally { $writeStream.Dispose() }
        } finally {
            $archive.Dispose()
        }
    } finally {
        $fileStream.Dispose()
    }

    Set-ControlText 141 $tampered
    $tamperResult = Invoke-DesktopAction 143 "invalid（无效）" "tampered package rejection"
    Save-WindowScreenshot $screenshot

    $reportObject = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    if ($reportObject.status -ne "valid") { throw "Persisted verification report is not valid." }

    $evidence = [ordered]@{
        executable = (Resolve-Path -LiteralPath $Executable).Path
        executable_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Executable).Hash.ToLowerInvariant()
        workspace = $workspace
        package = $package
        tampered_package = $tampered
        report = $report
        screenshot = $screenshot
        init = $initResult
        input_add = $inputResult
        output_add = $outputResult
        event = $eventResult
        seal = $sealResult
        verify = $verifyResult
        inspect = $inspectionResult
        reopen_workspace = $reopenWorkspaceResult
        tamper_rejection = $tamperResult
    }
    $evidencePath = Join-Path $EvidenceDirectory "ui-acceptance.json"
    [System.IO.File]::WriteAllText(
        $evidencePath,
        ($evidence | ConvertTo-Json -Depth 5),
        [System.Text.UTF8Encoding]::new($false)
    )
    [pscustomobject]@{
        Result = "PASS"
        Evidence = $evidencePath
        Screenshot = $screenshot
        Report = $report
    }
} catch {
    Write-ProgressLog ("FAIL " + $_.Exception.Message)
    throw
} finally {
    if ($script:window -ne [IntPtr]::Zero) {
        [void][AigcProofNative]::PostMessageW($script:window, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    if ($null -ne $process -and -not $process.HasExited) {
        if (-not $process.WaitForExit(5000)) { $process.Kill() }
    }
}
