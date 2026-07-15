[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $desktop)
$toolchain = Join-Path $env:USERPROFILE ".rustup\toolchains\1.85.0-x86_64-pc-windows-gnu"
$cargo = Join-Path $toolchain "bin\cargo.exe"
$rustc = Join-Path $toolchain "bin\rustc.exe"
$targetDirectory = Join-Path $repo "target\windows-gnu"
if (-not (Test-Path -LiteralPath $cargo -PathType Leaf) -or
    -not (Test-Path -LiteralPath $rustc -PathType Leaf)) {
    throw "Rust 1.85.0 x86_64-pc-windows-gnu is required under $toolchain."
}
$gccCommand = Get-Command "x86_64-w64-mingw32-gcc.exe" -ErrorAction SilentlyContinue
if ($null -eq $gccCommand) {
    throw "A MinGW-w64 GCC compatible with Rust's x86_64-pc-windows-gnu target is required."
}
$gcc = $gccCommand.Source
$gccBin = Split-Path -Parent $gcc
$archiveTool = Join-Path $gccBin "ar.exe"
if (-not (Test-Path -LiteralPath $gcc -PathType Leaf) -or
    -not (Test-Path -LiteralPath $archiveTool -PathType Leaf)) {
    throw "The MinGW-w64 GCC compiler and archive tool are required."
}
$env:PATH = $gccBin + ";" + (Join-Path $toolchain "bin") + ";" + $env:PATH
$env:RUSTC = $rustc
$env:CARGO_TARGET_DIR = $targetDirectory
$env:CC_x86_64_pc_windows_gnu = $gcc
$env:AR_x86_64_pc_windows_gnu = $archiveTool

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

Invoke-CapturedProcess $cargo "build --workspace --locked --release -p proof-napi -p proof-cli" $repo
$library = Join-Path $targetDirectory "release\proof_napi.dll"
if (-not (Test-Path -LiteralPath $library -PathType Leaf)) {
    throw "Expected Node-API library was not produced: $library"
}
$native = Join-Path $desktop "native"
New-Item -ItemType Directory -Force -Path $native | Out-Null
$addon = Join-Path $native "proof_napi.node"
Copy-Item -LiteralPath $library -Destination $addon -Force
$cli = Join-Path $targetDirectory "release\aigc-proof.exe"
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
    throw "Expected independent CLI was not produced: $cli"
}
[pscustomobject]@{
    Path = $addon
    SizeBytes = (Get-Item -LiteralPath $addon).Length
    Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $addon).Hash.ToLowerInvariant()
    CliPath = $cli
    CliSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $cli).Hash.ToLowerInvariant()
}
