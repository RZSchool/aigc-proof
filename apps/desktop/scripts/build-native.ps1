[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $desktop)
$workspace = Split-Path -Parent $repo
$toolchain = Join-Path $env:USERPROFILE ".rustup\toolchains\1.85.0-x86_64-pc-windows-gnu"
$cargo = Join-Path $toolchain "bin\cargo.exe"
$rustc = Join-Path $toolchain "bin\rustc.exe"
if (-not (Test-Path -LiteralPath $cargo -PathType Leaf) -or
    -not (Test-Path -LiteralPath $rustc -PathType Leaf)) {
    throw "Rust 1.85.0 x86_64-pc-windows-gnu is required under $toolchain."
}
$llvmBin = Join-Path $workspace ".tools\llvm-mingw-20260407-ucrt-x86_64\bin"
$clang = Join-Path $llvmBin "x86_64-w64-mingw32-clang.exe"
$archiveTool = Join-Path $llvmBin "x86_64-w64-mingw32-llvm-ar.exe"
if (-not (Test-Path -LiteralPath $clang -PathType Leaf) -or
    -not (Test-Path -LiteralPath $archiveTool -PathType Leaf)) {
    throw "Portable llvm-mingw 20260407 is required under workspace-root .tools."
}

function Invoke-CapturedProcess {
    param([string]$FilePath, [string]$Arguments, [string]$WorkingDirectory)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $FilePath
    $start.Arguments = $Arguments
    $start.WorkingDirectory = $WorkingDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables["PATH"] = (Join-Path $toolchain "bin") + ";" + $env:PATH
    $start.EnvironmentVariables["RUSTC"] = $rustc
    $start.EnvironmentVariables["CC_x86_64_pc_windows_gnu"] = $clang
    $start.EnvironmentVariables["AR_x86_64_pc_windows_gnu"] = $archiveTool
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "Failed to start $FilePath." }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    if (-not [string]::IsNullOrWhiteSpace($stdout.Result)) { Write-Host $stdout.Result }
    if (-not [string]::IsNullOrWhiteSpace($stderr.Result)) { Write-Host $stderr.Result }
    if ($process.ExitCode -ne 0) {
        throw "$FilePath failed with exit code $($process.ExitCode)."
    }
}

Invoke-CapturedProcess $cargo "build --workspace --locked --release -p proof-napi" $repo
$library = Join-Path $repo "target\release\proof_napi.dll"
if (-not (Test-Path -LiteralPath $library -PathType Leaf)) {
    throw "Expected Node-API library was not produced: $library"
}
$native = Join-Path $desktop "native"
New-Item -ItemType Directory -Force -Path $native | Out-Null
$addon = Join-Path $native "proof_napi.node"
Copy-Item -LiteralPath $library -Destination $addon -Force
[pscustomobject]@{
    Path = $addon
    SizeBytes = (Get-Item -LiteralPath $addon).Length
    Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $addon).Hash.ToLowerInvariant()
}
