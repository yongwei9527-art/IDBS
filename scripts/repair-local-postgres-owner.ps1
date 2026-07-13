<#
  修复本机 Windows PostgreSQL 旧库对象 owner 不一致导致的升级失败。
  安全行为：
  - 临时仅允许 127.0.0.1 使用 postgres 账号访问指定数据库；
  - 将 public schema 对象 owner 转给应用数据库账号；
  - 执行 schema 升级和 doctor 自检；
  - 始终恢复原始 pg_hba.conf；
  - 不 drop、不 truncate、不 reset、不清空业务数据。
#>
param(
  [string]$DatabaseName = 'idbs',
  [string]$PostgresUser = 'postgres',
  [string]$AppDbUser = 'idbs_user',
  [string]$ServiceName = 'postgresql-x64-16',
  [string]$DataDir = 'C:\Program Files\PostgreSQL\16\data',
  [string]$PgCtl = 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  Write-Host '当前 PowerShell 不是管理员权限，无法重载/重启 PostgreSQL 服务。'
  Write-Host '请关闭当前窗口，右键 Windows PowerShell 或 终端，选择“以管理员身份运行”，再执行：'
  Write-Host 'powershell -ExecutionPolicy Bypass -File E:\Rental-System\scripts\repair-local-postgres-owner.ps1'
  exit 1
}

function Write-Utf8NoBomFile {
  param([string]$Path, [string]$Value)
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Grant-PostgresConfigReadAccess {
  param([string]$TargetPath)
  $serviceAccount = $null
  try {
    $svcInfo = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
    $serviceAccount = $svcInfo.StartName
  } catch {
    Write-Host "未能自动读取 PostgreSQL 服务账号，将使用常见本机服务账号兜底。"
  }

  $accounts = @($serviceAccount, 'NT SERVICE\postgresql-x64-16', 'NT AUTHORITY\NetworkService') | Where-Object { $_ } | Select-Object -Unique
  & icacls $TargetPath /inheritance:e | Out-Null
  foreach ($account in $accounts) {
    if ($account -match 'LocalSystem|Local Service|LocalService') { continue }
    & icacls $TargetPath /grant "${account}:R" | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "已确认 PostgreSQL 服务账号可读取配置：$account" }
  }
}
function Sync-PostgresConfig {
  param([string]$Reason)
  Write-Host "同步 PostgreSQL 配置：$Reason"
  & $PgCtl reload -D $DataDir
  if ($LASTEXITCODE -eq 0) { return }
  Write-Host "pg_ctl reload 未成功，正在重启服务 $ServiceName ..."
  Restart-Service -Name $ServiceName -Force -ErrorAction Stop
  Start-Sleep -Seconds 3
  $svc = Get-Service -Name $ServiceName -ErrorAction Stop
  if ($svc.Status -ne 'Running') { throw "PostgreSQL 服务未运行：$($svc.Status)" }
}

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Hba = Join-Path $DataDir 'pg_hba.conf'
if (!(Test-Path -LiteralPath $Hba)) { throw "未找到 pg_hba.conf：$Hba" }
if (!(Test-Path -LiteralPath $PgCtl)) { throw "未找到 pg_ctl.exe：$PgCtl" }

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $Repo 'backups\pg-hba'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$Backup = Join-Path $BackupDir "pg_hba.conf.$Stamp.bak"
Copy-Item -LiteralPath $Hba -Destination $Backup -Force
$Original = Get-Content -Raw -Encoding UTF8 -LiteralPath $Hba
$Marker = "# IDBS temporary local owner repair $Stamp"
$TrustLine = "host    $DatabaseName    $PostgresUser    127.0.0.1/32    trust"

try {
  Write-Host "已备份 pg_hba.conf：$Backup"
  Write-Utf8NoBomFile -Path $Hba -Value ("$Marker`r`n$TrustLine`r`n$Original")
  Grant-PostgresConfigReadAccess -TargetPath $Hba
  Sync-PostgresConfig -Reason '临时本机 trust 规则'

  Push-Location $Repo
  try {
    $env:IDBS_APP_DB_USER = $AppDbUser
    $env:DATABASE_URL = "postgresql://$PostgresUser@127.0.0.1:5432/$DatabaseName"
    npm.cmd run db:transfer-owner
    if ($LASTEXITCODE -ne 0) { throw 'db:transfer-owner 执行失败' }
    npm.cmd run db:upgrade-schema
    if ($LASTEXITCODE -ne 0) { throw 'db:upgrade-schema 执行失败' }
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\IDBS_APP_DB_USER -ErrorAction SilentlyContinue
    npm.cmd run doctor
    if ($LASTEXITCODE -ne 0) { throw 'doctor 自检仍未通过' }
  } finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\IDBS_APP_DB_USER -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $Backup) {
    Copy-Item -LiteralPath $Backup -Destination $Hba -Force
    Grant-PostgresConfigReadAccess -TargetPath $Hba
    Sync-PostgresConfig -Reason '恢复原始 pg_hba.conf'
    Write-Host "pg_hba.conf 已恢复。备份位置：$Backup"
  }
}
