param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$SchemaPath = "./sql/schema.sql"
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
psql $DatabaseUrl -f $SchemaPath
Write-Host "Done."
