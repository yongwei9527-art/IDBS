param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$SchemaPath = "./sql/schema.sql",
  [string]$MigrationsDir = "./sql/migrations"
)

if (-not $DatabaseUrl) {
  Write-Error "DATABASE_URL is required. Set the environment variable or pass -DatabaseUrl."
  exit 1
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Error "psql was not found. Install PostgreSQL client tools first."
  exit 1
}

Write-Host "Initializing PostgreSQL schema from $SchemaPath"
psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $SchemaPath

if (Test-Path $MigrationsDir) {
  $markerQuery = @"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"@
  psql $DatabaseUrl -v ON_ERROR_STOP=1 -c $markerQuery | Out-Null
  Get-ChildItem $MigrationsDir -Filter *.sql | Sort-Object Name | ForEach-Object {
    $version = $_.BaseName
    $check = psql $DatabaseUrl -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'"
    if ($check -ne '1') {
      Write-Host "Applying migration $($_.Name)"
      psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $_.FullName
      psql $DatabaseUrl -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (version) VALUES ('$version')"
    }
  }
}

Write-Host "Done."
