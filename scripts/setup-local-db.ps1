param(
  [string]$PostgresBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5432,
  [string]$AdminUser = "postgres",
  [string]$AdminPassword = "",
  [string]$Database = "idbs",
  [string]$AppUser = "idbs_user",
  [string]$AppPassword = "generated-by-installer",
  [string]$SchemaPath = ".\sql\schema.sql",
  [string]$MigrationsDir = ".\sql\migrations"
)

$ErrorActionPreference = "Stop"

function Invoke-PostgresCommand {
  param([string]$Executable, [string[]]$Arguments, [switch]$CaptureOutput)
  $output = @(& $Executable @Arguments)
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL command failed with exit code $LASTEXITCODE." }
  if ($CaptureOutput) { return ($output -join "") }
  $output | Write-Output
}

$psql = Join-Path $PostgresBin "psql.exe"
$createdb = Join-Path $PostgresBin "createdb.exe"
if (-not (Test-Path $psql)) { $psql = (Get-Command psql -ErrorAction Stop).Source }
if (-not (Test-Path $createdb)) { $createdb = (Get-Command createdb -ErrorAction Stop).Source }
if (-not (Test-Path $SchemaPath)) { throw "Schema file not found: $SchemaPath" }

$previousPgPassword = $env:PGPASSWORD
$env:PGPASSWORD = $AdminPassword
try {
  $escapedAppPassword = $AppPassword.Replace("'", "''")
  Write-Host "Ensuring application database role '$AppUser'..."
  $roleSql = "DO $([char]36)$([char]36) BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$AppUser') THEN CREATE ROLE $AppUser LOGIN PASSWORD '$escapedAppPassword'; ELSE ALTER ROLE $AppUser WITH LOGIN PASSWORD '$escapedAppPassword'; END IF; END $([char]36)$([char]36);"
  Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", $roleSql)

  $databaseExists = (Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname = '$Database'") -CaptureOutput).Trim()
  if ($databaseExists -ne "1") {
    Write-Host "Creating database '$Database'..."
    Invoke-PostgresCommand $createdb @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-O", $AppUser, $Database)
  } else { Write-Host "Database '$Database' already exists." }

  Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "GRANT ALL PRIVILEGES ON DATABASE $Database TO $AppUser;")
  Write-Host "Applying schema: $SchemaPath"
  Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-f", $SchemaPath)

  if (Test-Path $MigrationsDir) {
    Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-c", "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());")
    Get-ChildItem $MigrationsDir -Filter *.sql | Where-Object { $_.Name -notmatch '(?i)(^|[._-])rollback([._-]|$)' } | Sort-Object Name | ForEach-Object {
      $version = $_.BaseName
      $applied = (Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", $Database, "-tAc", "SELECT 1 FROM schema_migrations WHERE version = '$version'") -CaptureOutput).Trim()
      if ($applied -ne "1") {
        Write-Host "Applying migration: $($_.Name)"
        Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", $_.FullName, "-c", "INSERT INTO schema_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING;")
      }
    }
  }

  Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AdminUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-c", "GRANT ALL ON SCHEMA public TO $AppUser; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $AppUser; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $AppUser; ALTER DEFAULT PRIVILEGES FOR ROLE $AdminUser IN SCHEMA public GRANT ALL ON TABLES TO $AppUser; ALTER DEFAULT PRIVILEGES FOR ROLE $AdminUser IN SCHEMA public GRANT ALL ON SEQUENCES TO $AppUser;")
  $env:PGPASSWORD = $AppPassword
  Invoke-PostgresCommand $psql @("-h", $HostName, "-p", $Port, "-U", $AppUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-c", "SELECT 'Local database is ready' AS status;")
} finally { $env:PGPASSWORD = $previousPgPassword }
