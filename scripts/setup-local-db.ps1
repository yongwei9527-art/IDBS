param(
  [string]$PostgresBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5432,
  [string]$AdminUser = "postgres",
  [string]$AdminPassword = "",
  [string]$Database = "idbs",
  [string]$AppUser = "idbs_user",
  [string]$AppPassword = "generated-by-installer",
  [string]$SchemaPath = ".\sql\schema.sql"
)

$ErrorActionPreference = "Stop"

$psql = Join-Path $PostgresBin "psql.exe"
$createdb = Join-Path $PostgresBin "createdb.exe"

if (-not (Test-Path $psql)) {
  $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psqlCommand) {
    throw "psql was not found. Pass -PostgresBin or add PostgreSQL bin to PATH."
  }
  $psql = $psqlCommand.Source
}

if (-not (Test-Path $createdb)) {
  $createdbCommand = Get-Command createdb -ErrorAction SilentlyContinue
  if (-not $createdbCommand) {
    throw "createdb was not found. Pass -PostgresBin or add PostgreSQL bin to PATH."
  }
  $createdb = $createdbCommand.Source
}

if (-not (Test-Path $SchemaPath)) {
  throw "Schema file was not found: $SchemaPath"
}

$previousPgPassword = $env:PGPASSWORD
$env:PGPASSWORD = $AdminPassword

try {
  $escapedAppPassword = $AppPassword.Replace("'", "''")
  Write-Host "Ensuring role '$AppUser' exists..."
  & $psql -h $HostName -p $Port -U $AdminUser -d postgres -v ON_ERROR_STOP=1 -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$AppUser') THEN CREATE ROLE $AppUser LOGIN PASSWORD '$escapedAppPassword'; ELSE ALTER ROLE $AppUser WITH LOGIN PASSWORD '$escapedAppPassword'; END IF; END `$`$;"

  $databaseExists = (& $psql -h $HostName -p $Port -U $AdminUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$Database'").Trim()
  if ($databaseExists -ne "1") {
    Write-Host "Creating database '$Database'..."
    & $createdb -h $HostName -p $Port -U $AdminUser -O $AppUser $Database
  } else {
    Write-Host "Database '$Database' already exists."
  }

  Write-Host "Granting database privileges..."
  & $psql -h $HostName -p $Port -U $AdminUser -d postgres -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE $Database TO $AppUser;"

  Write-Host "Importing schema from $SchemaPath..."
  & $psql -h $HostName -p $Port -U $AdminUser -d $Database -v ON_ERROR_STOP=1 -f $SchemaPath

  Write-Host "Granting schema privileges..."
  & $psql -h $HostName -p $Port -U $AdminUser -d $Database -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO $AppUser; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $AppUser; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $AppUser; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $AppUser; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $AppUser;"

  $env:PGPASSWORD = $AppPassword
  & $psql -h $HostName -p $Port -U $AppUser -d $Database -v ON_ERROR_STOP=1 -c "select 'local database ready' as status;"

  Write-Host ""
  Write-Host "DATABASE_URL=postgres://$AppUser`:$AppPassword@$HostName`:$Port/$Database"
} finally {
  $env:PGPASSWORD = $previousPgPassword
}
