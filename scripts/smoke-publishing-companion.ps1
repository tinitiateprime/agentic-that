$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "apps\publishing-companion-desktop\out\AgenticThat Publishing Companion-win32-x64"))
$executable = Join-Path $packageRoot "AgenticThat Publishing Companion.exe"
if (-not (Test-Path -LiteralPath $executable)) {
  throw "Build the packaged companion before running this smoke test."
}
if (Get-NetTCPConnection -LocalPort 8792 -State Listen -ErrorAction SilentlyContinue) {
  throw "Port 8792 is already occupied. Stop the development companion before this smoke test."
}

$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$smokeRoot = Join-Path $tempRoot ("AgenticThatCompanionSmoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $smokeRoot | Out-Null

try {
  $previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $env:AGENTICTHAT_COMPANION_DATA_DIR = $smokeRoot
  $env:AGENTICTHAT_COMPANION_DISABLE_AUTOSTART = "1"
  $process = Start-Process -FilePath $executable -ArgumentList "--hidden" -WindowStyle Hidden -PassThru

  $health = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8792/api/health" -TimeoutSec 2
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  if (-not $health) { throw "The packaged companion did not become healthy within 30 seconds." }
  if (-not $health.extensionBridge) { throw "The extension bridge is not enabled." }
  if (-not $health.companionInstanceId) { throw "The packaged companion instance was not identified." }
  if (-not $health.chromeInstalled) { throw "Google Chrome was not detected." }
  if (-not $health.automationReady) { throw "Browser automation is not ready." }
  foreach ($platform in @("facebook", "instagram", "x", "linkedin", "youtube")) {
    if ($health.platforms -notcontains $platform) { throw "The packaged runtime is missing $platform support." }
  }

  $productionOrigin = "https://agentic-that.netlify.app"
  $preflight = Invoke-WebRequest -UseBasicParsing -Method Options -Uri "http://127.0.0.1:8792/api/health" -Headers @{
    Origin = $productionOrigin
    "Access-Control-Request-Method" = "GET"
    "Access-Control-Request-Headers" = "authorization,content-type"
  } -TimeoutSec 5
  if ($preflight.StatusCode -ne 204) {
    throw "The production dashboard CORS preflight returned $($preflight.StatusCode)."
  }
  if ($preflight.Headers["Access-Control-Allow-Origin"] -ne $productionOrigin) {
    throw "The packaged companion does not allow the production dashboard origin."
  }

  if (-not (Test-Path -LiteralPath (Join-Path $smokeRoot "companion-settings.json"))) {
    throw "The packaged companion did not create protected settings."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $smokeRoot "publishing-data"))) {
    throw "The packaged companion did not create its isolated data directory."
  }

  Write-Host "Packaged companion smoke test passed." -ForegroundColor Green
  Write-Host "Process: $($process.Id)"
  Write-Host "Chrome: detected"
  Write-Host "Extension bridge: enabled"
  Write-Host "Production dashboard origin: allowed"
  Write-Host "Platforms: $($health.platforms -join ', ')"
} finally {
  Remove-Item Env:AGENTICTHAT_COMPANION_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:AGENTICTHAT_COMPANION_DISABLE_AUTOSTART -ErrorAction SilentlyContinue
  if ($null -ne $previousElectronRunAsNode) {
    $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
  }

  $packagedProcesses = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith(
      $packageRoot + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  }
  foreach ($packagedProcess in $packagedProcesses) {
    Stop-Process -Id $packagedProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2

  $resolvedSmokeRoot = [System.IO.Path]::GetFullPath($smokeRoot)
  if ($resolvedSmokeRoot.StartsWith($tempRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedSmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
