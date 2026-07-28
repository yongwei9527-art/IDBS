param(
  [switch]$Stop,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StatePath = Join-Path ([IO.Path]::GetTempPath()) 'rental-system-android-live.json'
$ViteLog = Join-Path ([IO.Path]::GetTempPath()) 'rental-system-vite.log'
$ViteErrorLog = Join-Path ([IO.Path]::GetTempPath()) 'rental-system-vite.error.log'
$ApiLog = Join-Path ([IO.Path]::GetTempPath()) 'rental-system-api.log'
$ApiErrorLog = Join-Path ([IO.Path]::GetTempPath()) 'rental-system-api.error.log'
$Adb = (Get-Command adb.exe -ErrorAction Stop).Source

function Test-Http([string]$Uri) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-Reverse([int]$Port) {
  return [bool]((& $Adb reverse --list) | Select-String "tcp:$Port tcp:$Port")
}

function Stop-OwnedProcess($ProcessId) {
  if (-not $ProcessId) { return }
  $process = Get-Process -Id ([int]$ProcessId) -ErrorAction SilentlyContinue
  if ($process) { Stop-Process -Id $process.Id -Force }
}

if ($Status) {
  Write-Output ("ApiReady=" + (Test-Http 'http://127.0.0.1:3000/ready'))
  Write-Output ("ViteReady=" + (Test-Http 'http://127.0.0.1:5173/v5/'))
  Write-Output ("Reverse3000=" + (Test-Reverse 3000))
  Write-Output ("Reverse5173=" + (Test-Reverse 5173))
  exit 0
}

if ($Stop) {
  if (Test-Path $StatePath) {
    $state = Get-Content $StatePath -Raw | ConvertFrom-Json
    Stop-OwnedProcess $state.vitePid
    Stop-OwnedProcess $state.apiPid
    Remove-Item -LiteralPath $StatePath -Force
  }
  & $Adb reverse --remove tcp:5173 2>$null
  Write-Output 'Android live reload stopped.'
  exit 0
}

$devices = @((& $Adb devices) | Where-Object { $_ -match "\tdevice$" })
if ($devices.Count -ne 1) { throw "Expected exactly one authorized Android device; found $($devices.Count)." }

& $Adb reverse tcp:3000 tcp:3000 | Out-Null
& $Adb reverse tcp:5173 tcp:5173 | Out-Null
$state = [ordered]@{ apiPid = $null; vitePid = $null }

if (-not (Test-Http 'http://127.0.0.1:3000/ready')) {
  $api = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server.js' -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $ApiLog -RedirectStandardError $ApiErrorLog -PassThru
  $state.apiPid = $api.Id
}

$apiReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  if (Test-Http 'http://127.0.0.1:3000/ready') { $apiReady = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $apiReady) { throw "API did not become ready. See $ApiErrorLog" }

if (-not (Test-Http 'http://127.0.0.1:5173/v5/')) {
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $vite = Start-Process -FilePath $npm -ArgumentList '--prefix','web','run','dev','--','--host','127.0.0.1','--port','5173','--strictPort' -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $ViteLog -RedirectStandardError $ViteErrorLog -PassThru
  $state.vitePid = $vite.Id
}

$viteReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  if (Test-Http 'http://127.0.0.1:5173/v5/') { $viteReady = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $viteReady) { throw "Vite did not become ready. See $ViteErrorLog" }

[IO.File]::WriteAllText($StatePath, ($state | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
& $Adb shell am force-stop com.laboratory.managementsystem
& $Adb shell am start -n com.laboratory.managementsystem/.MainActivity | Out-Null
Write-Output 'Android live reload ready at http://127.0.0.1:5173/v5/ over USB.'
Write-Output 'Stop with: npm run android:live:stop'