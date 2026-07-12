[CmdletBinding()]
param(
    [string]$PackageDirectory,
    [string]$EvidenceDirectory
)

$ErrorActionPreference = "Stop"
$desktop = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $desktop)
$workspace = Split-Path -Parent $repo
if ([string]::IsNullOrWhiteSpace($PackageDirectory)) {
    $PackageDirectory = Join-Path $workspace "app\AIGC-Proof-Workbench"
}
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    $EvidenceDirectory = Join-Path $PackageDirectory "acceptance-evidence-final"
}

$node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$tsx = Join-Path $desktop "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Bundled Node.js is missing: $node" }
if (-not (Test-Path -LiteralPath $tsx -PathType Leaf)) { throw "tsx is missing: $tsx" }

$env:AIGC_PROOF_PACKAGED_EXE = Join-Path $PackageDirectory "AIGC-Proof.exe"
$env:AIGC_PROOF_QA_EVIDENCE = $EvidenceDirectory
$qa = Start-Process -FilePath $node -ArgumentList @(
    $tsx,
    (Join-Path $desktop "qa\workbench-smoke.ts"),
    "--mode=packaged"
) -WorkingDirectory $desktop -Wait -PassThru -NoNewWindow
if ($qa.ExitCode -ne 0) { throw "Packaged Electron/CDP QA failed with exit code $($qa.ExitCode)." }

$env:AIGC_PROOF_PACKAGE_DIR = $PackageDirectory
$env:AIGC_PROOF_BOUNDARY_EVIDENCE = Join-Path $EvidenceDirectory "package-boundary.json"
$boundary = Start-Process -FilePath $node -ArgumentList @(
    $tsx,
    (Join-Path $desktop "qa\package-boundary.ts")
) -WorkingDirectory $desktop -Wait -PassThru -NoNewWindow
if ($boundary.ExitCode -ne 0) { throw "Package-boundary QA failed with exit code $($boundary.ExitCode)." }
