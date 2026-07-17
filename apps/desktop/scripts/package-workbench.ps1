[CmdletBinding()]
param(
    [string]$Destination
)

$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $desktop)
$workspace = Split-Path -Parent $repo
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $workspace "app\AIGC-Proof-Workbench"
}
$nodeBin = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$toolRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin"
$overrideBin = Join-Path $toolRoot "override"
$fallbackBin = Join-Path $toolRoot "fallback"
$rustToolchain = if ([string]::IsNullOrWhiteSpace($env:AIGC_PROOF_RUST_TOOLCHAIN)) {
    Join-Path $env:USERPROFILE ".rustup\toolchains\1.88.0-x86_64-pc-windows-msvc"
} else {
    $env:AIGC_PROOF_RUST_TOOLCHAIN
}
$rustc = Join-Path $rustToolchain "bin\rustc.exe"
$pnpm = @(
    (Join-Path $toolRoot "pnpm.cmd"),
    (Join-Path $fallbackBin "pnpm.cmd")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($pnpm)) {
    throw "Bundled pnpm was not found under $toolRoot."
}
$env:PATH = (Join-Path $desktop "node_modules\.bin") + ";" + $nodeBin + ";" + $overrideBin + ";" + $fallbackBin + ";" + $env:PATH
$env:CI = "true"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"

function Invoke-Pnpm {
    param([Parameter(Mandatory = $true)][string]$Arguments)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $env:ComSpec
    $start.Arguments = "/d /c call `"$pnpm`" $Arguments"
    $start.WorkingDirectory = $desktop
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "Failed to start pnpm $Arguments." }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    if (-not [string]::IsNullOrWhiteSpace($stdout.Result)) { Write-Host $stdout.Result }
    if (-not [string]::IsNullOrWhiteSpace($stderr.Result)) { Write-Host $stderr.Result }
    if ($process.ExitCode -ne 0) { throw "pnpm $Arguments failed with exit code $($process.ExitCode)." }
}

function Get-VersionText {
    param([string]$FilePath, [string]$Arguments)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $FilePath
    $start.Arguments = $Arguments
    $start.WorkingDirectory = $desktop
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "Failed to start $FilePath." }
    $output = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "$FilePath version check failed." }
    $output.Trim()
}

function Invoke-NodeTool {
    param(
        [Parameter(Mandatory = $true)][string]$Tool,
        [Parameter(Mandatory = $true)][string]$Arguments
    )
    $relative = switch ($Tool) {
        "prettier" { "node_modules\prettier\bin\prettier.cjs" }
        "tsc" { "node_modules\typescript\bin\tsc" }
        "eslint" { "node_modules\eslint\bin\eslint.js" }
        "vitest" { "node_modules\vitest\vitest.mjs" }
        "esbuild" { "node_modules\esbuild\bin\esbuild" }
        "vite" { "node_modules\vite\bin\vite.js" }
        "electron-builder" { "node_modules\electron-builder\cli.js" }
        default { throw "Unknown Node tool: $Tool" }
    }
    $toolPath = Join-Path $desktop $relative
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw "Node tool is missing: $toolPath" }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = Join-Path $nodeBin "node.exe"
    $start.Arguments = "`"$toolPath`" $Arguments"
    $start.WorkingDirectory = $desktop
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "Failed to start $Tool $Arguments." }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    if (-not [string]::IsNullOrWhiteSpace($stdout.Result)) { Write-Host $stdout.Result }
    if (-not [string]::IsNullOrWhiteSpace($stderr.Result)) { Write-Host $stderr.Result }
    if ($process.ExitCode -ne 0) { throw "$Tool $Arguments failed with exit code $($process.ExitCode)." }
}

& (Join-Path $PSScriptRoot "build-native.ps1")
Invoke-Pnpm "install --frozen-lockfile --config.block-exotic-subdeps=false"
Invoke-NodeTool "prettier" "--check ."
$generatedDirectories = @(
    (Join-Path $desktop "dist"),
    (Join-Path $desktop "release")
)
foreach ($generatedDirectory in $generatedDirectories) {
    if (Test-Path -LiteralPath $generatedDirectory) {
        Remove-Item -LiteralPath $generatedDirectory -Recurse -Force
    }
}
Invoke-NodeTool "tsc" "-p packages\host-contracts\tsconfig.json"
Invoke-NodeTool "tsc" "-p packages\creation-core\tsconfig.json"
Invoke-NodeTool "tsc" "--noEmit -p packages\host-contracts\tsconfig.json"
Invoke-NodeTool "tsc" "--noEmit -p packages\creation-core\tsconfig.json"
Invoke-NodeTool "tsc" "--noEmit -p tsconfig.renderer.json"
Invoke-NodeTool "tsc" "--noEmit -p tsconfig.main.json"
Invoke-NodeTool "tsc" "--noEmit -p tsconfig.preload.json"
Invoke-NodeTool "tsc" "--noEmit -p tsconfig.utility.json"
Invoke-NodeTool "tsc" "--noEmit -p tsconfig.qa.json"
Invoke-NodeTool "eslint" "."
Invoke-NodeTool "vitest" "run --config packages\host-contracts\vitest.config.ts"
Invoke-NodeTool "vitest" "run --config packages\creation-core\vitest.config.ts"
Invoke-NodeTool "vitest" "run"
Invoke-NodeTool "tsc" "-p tsconfig.main.json"
Invoke-NodeTool "tsc" "-p tsconfig.utility.json"
Invoke-NodeTool "esbuild" "src/preload/preload.ts --bundle --platform=node --format=cjs --external:electron --outfile=dist/preload/preload.js"
Invoke-NodeTool "vite" "build"
Invoke-NodeTool "electron-builder" "--win dir --x64"

$source = Join-Path $desktop "release\win-unpacked"
$sourceExe = Join-Path $source "AIGC-Proof.exe"
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Packaged executable was not produced: $sourceExe"
}
if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $Destination -Recurse -Force
Copy-Item -LiteralPath (Join-Path $desktop "README.txt") -Destination (Join-Path $Destination "README.txt") -Force
Copy-Item -LiteralPath (Join-Path $repo "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $Destination "THIRD_PARTY_NOTICES.md") -Force

$executable = Join-Path $Destination "AIGC-Proof.exe"
$asar = Join-Path $Destination "resources\app.asar"
$addon = Join-Path $Destination "resources\native\proof_napi.node"
$nodeVersion = Get-VersionText (Join-Path $nodeBin "node.exe") "--version"
$pnpmVersion = Get-VersionText $env:ComSpec "/d /c call `"$pnpm`" --version"
$rustcVersion = Get-VersionText $rustc "-Vv"
$metadata = [ordered]@{
    workbench_version = "1.1.0"
    host_contract_version = "2.1.0"
    native_api_version = "2.1.0"
    native_engine_version = "1.0.0"
    protocol_version = "1.0.0"
    platform = "Windows x64"
    windows_version = [Environment]::OSVersion.VersionString
    executable = $executable
    executable_size_bytes = (Get-Item -LiteralPath $executable).Length
    executable_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $executable).Hash.ToLowerInvariant()
    app_asar_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $asar).Hash.ToLowerInvariant()
    native_addon_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $addon).Hash.ToLowerInvariant()
    host_contract_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $desktop "packages\host-contracts\dist\index.js")).Hash.ToLowerInvariant()
    creation_core_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $desktop "packages\creation-core\dist\index.js")).Hash.ToLowerInvariant()
    creation_workflow_template_sha256 = "623d53adee2d221ea3fd62ffa2749466e742c948d190eed7c00f39db1cba4206"
    creation_snapshot_schema_sha256 = "a4ceabdf7f40d166f4977da87e5820eda6e251ce3bc974571948913187e0e824"
    comfyui_compatibility_baseline = "0.27.0"
    comfyui_license = "GPL-3.0-only; external user-managed component"
    comfyui_distribution = "user-authorized external installation; not packaged"
    rust_toolchain = $rustcVersion
    linker_toolchain = "MSVC selected by Rust target x86_64-pc-windows-msvc"
    node = $nodeVersion
    pnpm = $pnpmVersion
    build_command = "apps/desktop/scripts/package-workbench.ps1"
}
[IO.File]::WriteAllText(
    (Join-Path $Destination "artifact-metadata.json"),
    ($metadata | ConvertTo-Json -Depth 4),
    [Text.UTF8Encoding]::new($false)
)
$metadata
