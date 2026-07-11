[CmdletBinding()]
param(
    [string]$Destination
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path (Split-Path -Parent $repo) "app\AIGC-Proof-Desktop-Preview"
}

$toolchainRoot = Join-Path $env:USERPROFILE ".rustup\toolchains\1.85.0-x86_64-pc-windows-gnu"
$cargo = Join-Path $toolchainRoot "bin\cargo.exe"
$rustc = Join-Path $toolchainRoot "bin\rustc.exe"
if (-not (Test-Path -LiteralPath $cargo -PathType Leaf) -or
    -not (Test-Path -LiteralPath $rustc -PathType Leaf)) {
    throw "Rust 1.85.0 Windows GNU toolchain is not installed under $toolchainRoot."
}
function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $FilePath
    $start.Arguments = $Arguments
    $start.WorkingDirectory = $WorkingDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables["PATH"] = (Join-Path $toolchainRoot "bin") + ";" + $env:PATH
    $start.EnvironmentVariables["RUSTC"] = $rustc
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) {
        throw "Failed to start $FilePath."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdoutTask.Result
        Stderr = $stderrTask.Result
    }
}

$versionResult = Invoke-CapturedProcess -FilePath $rustc -Arguments "--version" -WorkingDirectory $repo
$version = $versionResult.Stdout.Trim()
if ($versionResult.ExitCode -ne 0 -or $version -notmatch '^rustc 1\.85\.0 ') {
    throw "Rust 1.85.0 Windows GNU toolchain is required; observed: $version $($versionResult.Stderr)"
}

$build = Invoke-CapturedProcess -FilePath $cargo -Arguments "build --workspace --locked --release -p proof-desktop" -WorkingDirectory $repo
if (-not [string]::IsNullOrWhiteSpace($build.Stdout)) {
    Write-Host $build.Stdout
}
if (-not [string]::IsNullOrWhiteSpace($build.Stderr)) {
    Write-Host $build.Stderr
}
if ($build.ExitCode -ne 0) {
    throw "Desktop release build failed with exit code $($build.ExitCode)."
}

$executable = Join-Path $repo "target\release\AIGC-Proof.exe"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Expected executable was not produced: $executable"
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $Destination "AIGC-Proof.exe") -Force
Copy-Item -LiteralPath (Join-Path $repo "crates\proof-desktop\README.txt") -Destination (Join-Path $Destination "README.txt") -Force

$artifact = Get-Item -LiteralPath (Join-Path $Destination "AIGC-Proof.exe")
$digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact.FullName).Hash.ToLowerInvariant()
[pscustomobject]@{
    Version = "0.2.0"
    Platform = "windows-x64-gnu"
    Path = $artifact.FullName
    SizeBytes = $artifact.Length
    Sha256 = $digest
}
