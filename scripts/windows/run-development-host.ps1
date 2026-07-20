$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$runtimeDirectory = Join-Path $repositoryRoot ".pidex-data-dev"
$pidPath = Join-Path $runtimeDirectory "development-host-task.pid"
$logPath = Join-Path $runtimeDirectory "development-host.log"
$exitCode = 1

New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
Set-Content -LiteralPath $pidPath -Value $PID -NoNewline
Set-Location $repositoryRoot

if (-not (Get-Command openssl.exe -ErrorAction SilentlyContinue)) {
  $gitOpenSslDirectory = "C:\Program Files\Git\mingw64\bin"
  if (Test-Path (Join-Path $gitOpenSslDirectory "openssl.exe")) {
    $env:PATH = "$gitOpenSslDirectory;$env:PATH"
  }
}

try {
  $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
  "[$(Get-Date -Format o)] Starting Pidex development Host." | Add-Content $logPath
  $ErrorActionPreference = "Continue"
  try {
    & $npmPath run dev 2>&1 | ForEach-Object {
      $_.ToString() | Add-Content $logPath
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = "Stop"
  }
  "[$(Get-Date -Format o)] Pidex development Host exited with code $exitCode." | Add-Content $logPath
} catch {
  "[$(Get-Date -Format o)] Pidex development Host failed: $($_.Exception.Message)" | Add-Content $logPath
} finally {
  if ((Test-Path $pidPath) -and ((Get-Content $pidPath -Raw).Trim() -eq [string]$PID)) {
    Remove-Item $pidPath -Force
  }
}

exit $exitCode
