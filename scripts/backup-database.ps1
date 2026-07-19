# IDBS database backup (Windows)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/backup-database.ps1
# Optional Task Scheduler daily:
#   schtasks /Create /TN "IDBS-DB-Backup" /SC DAILY /ST 02:15 /TR "powershell -ExecutionPolicy Bypass -File C:\path\to\Rental-System\scripts\backup-database.ps1" /RL LIMITED

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
Set-Location $Root

$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -notmatch "=") { return }
    $parts = $_.Split("=", 2)
    if ($parts.Length -eq 2) {
      $name = $parts[0].Trim()
      $value = $parts[1].Trim().Trim('"')
      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

if (-not $env:BACKUP_DIR) {
  $env:BACKUP_DIR = Join-Path $Root "backups\db"
}
if (-not $env:BACKUP_RETENTION_DAYS) {
  $env:BACKUP_RETENTION_DAYS = "14"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $candidate = "C:\Users\$env:USERNAME\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $candidate) { $nodeCmd = $candidate } else { throw "node not found on PATH" }
} else {
  $nodeCmd = $node.Source
}

& $nodeCmd (Join-Path $Root "scripts\backup-database.js")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeCmd (Join-Path $Root "scripts\backup-database.js") --verify-latest
exit $LASTEXITCODE
