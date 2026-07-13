[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackageDirectory,
    [Parameter(Mandatory = $true)][string]$QaEvidence
)

$ErrorActionPreference = "Stop"
$exe = Join-Path $PackageDirectory "AIGC-Proof.exe"
$required = @(
    $exe,
    (Join-Path $PackageDirectory "README.txt"),
    (Join-Path $PackageDirectory "artifact-metadata.json"),
    (Join-Path $PackageDirectory "resources\app.asar"),
    (Join-Path $PackageDirectory "resources\native\proof_napi.node"),
    (Join-Path $QaEvidence "qa-result.json"),
    (Join-Path $QaEvidence "tamper-rejection.png"),
    (Join-Path $QaEvidence "reopened-workbench.png"),
    (Join-Path $QaEvidence "workspace-create-existing-guidance.png"),
    (Join-Path $QaEvidence "workspace-created-and-opened.png"),
    (Join-Path $QaEvidence "capability-diagnostics.png"),
    (Join-Path $QaEvidence "layout-1320x880-top.png"),
    (Join-Path $QaEvidence "layout-1320x880-middle.png"),
    (Join-Path $QaEvidence "layout-1320x880-lower.png"),
    (Join-Path $QaEvidence "layout-1040x720-top.png"),
    (Join-Path $QaEvidence "layout-1040x720-middle.png"),
    (Join-Path $QaEvidence "layout-1040x720-lower.png")
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required packaged evidence is missing: $path" }
}
if (Get-ChildItem -LiteralPath $PackageDirectory -Recurse -File -Filter "*.map") {
    throw "Packaged workbench contains source maps."
}
$qaPath = Join-Path $QaEvidence "qa-result.json"
$utf8NoBom = [Text.UTF8Encoding]::new($false)
$qa = [IO.File]::ReadAllText($qaPath, $utf8NoBom) | ConvertFrom-Json
$metadataPath = Join-Path $PackageDirectory "artifact-metadata.json"
$metadata = [IO.File]::ReadAllText($metadataPath, $utf8NoBom) | ConvertFrom-Json
if ($metadata.workbench_version -ne "0.3.0" -or
    $metadata.host_contract_version -ne "1.1.0" -or
    $metadata.native_api_version -ne "1.1.0" -or
    $metadata.native_engine_version -ne "0.2.0" -or
    $metadata.protocol_version -ne "0.2.0") {
    throw "Packaged artifact version metadata is invalid."
}
if ($qa.result -ne "PASS" -or
    $qa.mode -ne "packaged" -or
    $qa.protocol -ne "file:" -or
    $qa.workbenchVersion -ne "0.3.0" -or
    $qa.contractVersion -ne "1.1.0" -or
    $qa.nativeApiVersion -ne "1.1.0" -or
    $qa.engineVersion -ne "0.2.0" -or
    $qa.protocolVersion -ne "0.2.0") {
    throw "Packaged CDP QA result is invalid."
}
if (($qa.steps | Where-Object result -ne "PASS").Count -ne 0) {
    throw "One or more packaged QA steps did not pass."
}
foreach ($output in @($qa.database, $qa.workspace, $qa.package, $qa.tamperedPackage, $qa.report)) {
    if (-not (Test-Path -LiteralPath $output)) { throw "Packaged QA output is missing: $output" }
}

$normalData = Join-Path $QaEvidence "normal-launch-user-data"
$process = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=`"$normalData`"" -PassThru
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $process.Refresh()
        if ($process.HasExited) { throw "Normal packaged launch exited with code $($process.ExitCode)." }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw "Normal packaged launch did not create a window." }
    foreach ($port in @(9322, 9324, 9326)) {
        $client = [Net.Sockets.TcpClient]::new()
        try {
            if ($client.ConnectAsync("127.0.0.1", $port).Wait(500) -and $client.Connected) {
                throw "Normal launch exposed QA/CDP port $port."
            }
        } finally { $client.Dispose() }
    }
    if (-not $process.CloseMainWindow()) { throw "Normal packaged window did not accept a clean close." }
    if (-not $process.WaitForExit(10000)) { throw "Normal packaged process did not exit cleanly." }
} finally {
    if (-not $process.HasExited) { $process.Kill() }
}

$result = [pscustomobject]@{
    Result = "PASS"
    Executable = $exe
    ExecutableSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()
    PackagedQa = (Join-Path $QaEvidence "qa-result.json")
    NormalLaunch = "PASS"
    NormalLaunchCdpDisabled = "PASS"
    CleanExit = "PASS"
}
[IO.File]::WriteAllText(
    (Join-Path $QaEvidence "powershell-verification.json"),
    ($result | ConvertTo-Json -Depth 4),
    $utf8NoBom
)
$result
