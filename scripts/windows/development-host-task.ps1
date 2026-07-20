param(
  [Parameter(Position = 0)]
  [ValidateSet("install", "restart", "stop", "uninstall", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$taskName = "Pidex Development Host"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$runnerPath = Join-Path $PSScriptRoot "run-development-host.ps1"
$runtimeDirectory = Join-Path $repositoryRoot ".pidex-data-dev"
$pidPath = Join-Path $runtimeDirectory "development-host-task.pid"
$logPath = Join-Path $runtimeDirectory "development-host.log"

function Get-PidexTask {
  Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Stop-PidexTask {
  $task = Get-PidexTask
  if (-not $task) {
    return
  }

  if (Test-Path $pidPath) {
    $hostPid = 0
    if ([int]::TryParse((Get-Content $pidPath -Raw).Trim(), [ref]$hostPid)) {
      $hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $hostPid" -ErrorAction SilentlyContinue
      if ($hostProcess -and $hostProcess.CommandLine -like "*$runnerPath*") {
        & taskkill.exe /PID $hostPid /T /F | Out-Null
      }
    }
    Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  }

  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Start-PidexTask {
  if (-not (Get-PidexTask)) {
    throw "The '$taskName' task is not installed. Run 'npm run dev:task:install' first."
  }

  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 2
  $task = Get-PidexTask
  if ($task.State -ne "Running") {
    throw "The task did not remain running. Check '$logPath'."
  }
  Write-Host "Pidex development Host task is running."
  Write-Host "Log: $logPath"
}

switch ($Action) {
  "install" {
    if ($env:OS -ne "Windows_NT") {
      throw "The Pidex development Host task is supported only on Windows."
    }
    if (-not (Test-Path $runnerPath)) {
      throw "Development Host runner is missing: $runnerPath"
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
      throw "npm.cmd is not available on PATH."
    }

    Stop-PidexTask
    $powerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerPath`""
    $actionDefinition = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $repositoryRoot
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -MultipleInstances IgnoreNew `
      -RestartCount 3 `
      -RestartInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask `
      -TaskName $taskName `
      -Description "Runs the Pidex development Host for the signed-in user." `
      -Action $actionDefinition `
      -Trigger $trigger `
      -Principal $principal `
      -Settings $settings `
      -Force | Out-Null
    Start-PidexTask
  }
  "restart" {
    Stop-PidexTask
    Start-PidexTask
  }
  "stop" {
    Stop-PidexTask
    Write-Host "Pidex development Host task is stopped."
  }
  "uninstall" {
    Stop-PidexTask
    if (Get-PidexTask) {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    Write-Host "Pidex development Host task is uninstalled."
  }
  "status" {
    $task = Get-PidexTask
    if (-not $task) {
      Write-Host "Pidex development Host task is not installed."
      exit 1
    }
    Write-Host "Pidex development Host task state: $($task.State)"
    Write-Host "Log: $logPath"
  }
}
