#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Root
if (-not (Test-Path (Join-Path $Root 'package.json'))) { $Root = (Get-Location).Path }

Write-Host "==> Root: $Root"
Set-Location $Root

function Find-Npm {
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in @(
    "$env:ProgramFiles\nodejs\npm.cmd",
    "${env:ProgramFiles(x86)}\nodejs\npm.cmd",
    "$env:LOCALAPPDATA\Programs\node\npm.cmd"
  )) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

$npm = Find-Npm
if (-not $npm) {
  Write-Host "未找到系统 npm。请先安装 Node.js LTS: https://nodejs.org/" -ForegroundColor Yellow
  Write-Host "安装后重新运行本脚本。"
  exit 1
}
Write-Host "==> Using npm: $npm"

Write-Host "==> Root dependencies"
& $npm ci
if ($LASTEXITCODE -ne 0) { & $npm install }

Write-Host "==> Web dependencies + ESLint/Prettier"
Set-Location (Join-Path $Root 'web')
& $npm install
& $npm install -D eslint@9 @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh prettier eslint-config-prettier

Write-Host "==> Lint"
& $npm run lint
if ($LASTEXITCODE -ne 0) { Write-Host "lint 有问题，可稍后修" -ForegroundColor Yellow }

Set-Location $Root
Write-Host "==> Playwright Chromium"
& $npm exec -- playwright install chromium

Write-Host "==> Unit tests"
node scripts/run-unit-tests.js

Write-Host "全部依赖安装流程结束。" -ForegroundColor Green
