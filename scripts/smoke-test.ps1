$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("aigc-proof-smoke-" + [guid]::NewGuid())
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$cargo = if ($env:CARGO) { $env:CARGO } else { "cargo" }

function ConvertTo-NativeArgument {
    param([string]$Argument)

    if ($Argument -notmatch '[\s"]') {
        return $Argument
    }
    $escaped = $Argument -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function Invoke-Cargo {
    param([string[]]$CargoArguments)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $cargo
    $startInfo.Arguments = (($CargoArguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join " ")
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "cargo could not be started"
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($stderr) {
        [Console]::Error.Write($stderr)
    }
    if ($process.ExitCode -ne 0) {
        throw "cargo exited with code $($process.ExitCode)"
    }
    if ($stdout) {
        Write-Output $stdout
    }
}

New-Item -ItemType Directory -Path $work | Out-Null
try {
    [System.IO.File]::WriteAllText((Join-Path $work "input.txt"), "input`r`n", $utf8WithoutBom)
    [System.IO.File]::WriteAllText((Join-Path $work "output.txt"), "output`r`n", $utf8WithoutBom)
    [System.IO.File]::WriteAllText(
        (Join-Path $work "generation-event.json"),
        "{`r`n  `"model`": `"demo-model`",`r`n  `"operation`": `"text-transformation`",`r`n  `"note`": `"AIGC-Proof 0.2 Windows CLI verification demo`"`r`n}`r`n",
        $utf8WithoutBom
    )

    $manifest = Join-Path $root "Cargo.toml"
    $workspace = Join-Path $work "demo-workspace"
    $package = Join-Path $work "demo.aigcproof"
    $reportPath = Join-Path $work "verification-result.json"

    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "init", $workspace, "--project-name", "AIGC-Proof 0.2 demo")
    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "add", $workspace, (Join-Path $work "input.txt"), "--role", "input")
    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "add", $workspace, (Join-Path $work "output.txt"), "--role", "output")
    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "record", $workspace, "--event-type", "generation", "--payload-file", (Join-Path $work "generation-event.json"))
    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "seal", $workspace, "--output", $package, "--legacy-unsigned-v02")
    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "verify", $package)
    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "verify", $package, "--json", $reportPath)
    Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "inspect", $package)
    $inspectionText = Invoke-Cargo -CargoArguments @("run", "--locked", "-p", "proof-cli", "--manifest-path", $manifest, "--", "inspect", $package, "--json")

    if (-not (Test-Path -LiteralPath $package -PathType Leaf)) {
        throw "smoke test package was not created"
    }
    if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
        throw "smoke test verification report was not created"
    }

    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if ($report.status -ne "valid" -or $report.assurance.internal_integrity -ne "valid") {
        throw "smoke test verification report is not valid"
    }
    if (
        $report.assurance.creator_identity -ne "not_verified" -or
        $report.assurance.digital_signature -ne "not_present" -or
        $report.assurance.trusted_time -ne "not_present" -or
        $report.assurance.originality -ne "not_evaluated"
    ) {
        throw "smoke test report exceeded the v0.2 assurance boundary"
    }

    $inspection = ($inspectionText -join "`n") | ConvertFrom-Json
    if ($inspection.verification_performed -ne $false) {
        throw "inspect JSON unexpectedly claims verification was performed"
    }
}
finally {
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}
