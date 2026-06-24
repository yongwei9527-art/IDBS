param(
  [Parameter(Mandatory=$true)][string]$EnvId
)
$sql = Get-Content -Path "./sql/schema.sql" -Raw
Write-Host "正在初始化 CloudBase PostgreSQL 数据库..."
tcb db execute -e $EnvId --sql $sql
Write-Host "完成。"
