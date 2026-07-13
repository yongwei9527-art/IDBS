param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$SchemaPath = "./sql/schema.sql",
  [string]$MigrationsDir = "./sql/migrations"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if (-not $DatabaseUrl) {
  Write-Error "未配置 DATABASE_URL，请设置环境变量或传入 -DatabaseUrl。"
  exit 1
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Error "未找到 psql，请先安装 PostgreSQL 客户端工具，或把 bin 目录加入 PATH。"
  exit 1
}

Write-Host "正在导入 PostgreSQL 表结构： $SchemaPath"
psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $SchemaPath

if (Test-Path $MigrationsDir) {
  $markerQuery = @"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"@
  psql $DatabaseUrl -v ON_ERROR_STOP=1 -c $markerQuery | Out-Null
  Get-ChildItem $MigrationsDir -Filter *.sql | Where-Object { $_.Name -notmatch '(?i)(^|[._-])rollback([._-]|$)' } | Sort-Object Name | ForEach-Object {
    $version = $_.BaseName
    $check = psql $DatabaseUrl -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'"
    if ($check -ne '1') {
      Write-Host "正在执行迁移： $($_.Name)"
      psql $DatabaseUrl -v ON_ERROR_STOP=1 --single-transaction -f $_.FullName -c "INSERT INTO schema_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING;"
    }
  }
}

Write-Host "数据库初始化完成。"
