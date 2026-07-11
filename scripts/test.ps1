$ErrorActionPreference = "Stop"
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
    $startInfo.RedirectStandardOutput = $false
    $startInfo.RedirectStandardError = $false
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "cargo could not be started"
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "cargo exited with code $($process.ExitCode)"
    }
}

Invoke-Cargo -CargoArguments @("fmt", "--all", "--check")
Invoke-Cargo -CargoArguments @("check", "--workspace", "--locked")
Invoke-Cargo -CargoArguments @("clippy", "--workspace", "--all-targets", "--all-features", "--locked", "--", "-D", "warnings")
Invoke-Cargo -CargoArguments @("test", "--workspace", "--locked")
Invoke-Cargo -CargoArguments @("doc", "--workspace", "--no-deps", "--locked")
& (Join-Path $PSScriptRoot "smoke-test.ps1")
