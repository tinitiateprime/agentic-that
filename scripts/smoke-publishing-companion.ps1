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
  $smokeUsername = "operations.manager"
  $smokePassword = "CompanionSmoke@2026"
  $smokeSecret = "companion-smoke-auth-secret-that-is-long-enough-for-local-token-signing"
  $encode = {
    param([string]$Value)
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
  }
  $seedSettings = @{
    version = 1
    username = $smokeUsername
    password = @{ protected = $false; value = (& $encode $smokePassword) }
    authSecret = @{ protected = $false; value = (& $encode $smokeSecret) }
    instanceId = [guid]::NewGuid().ToString("N")
    autoStart = $false
    publishingInteractionConsent = $true
    createdAt = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText(
    (Join-Path $smokeRoot "companion-settings.json"),
    $seedSettings,
    (New-Object Text.UTF8Encoding($false))
  )

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
  if (-not $health.embeddedBrowser) { throw "The embedded live publishing browser is not enabled." }
  if (-not $health.automationReady) { throw "Browser automation is not ready." }
  foreach ($platform in @("facebook", "instagram", "x", "linkedin", "youtube")) {
    if ($health.platforms -notcontains $platform) { throw "The packaged runtime is missing $platform support." }
  }

  $activePortFile = Join-Path $smokeRoot "DevToolsActivePort"
  $debugPort = $null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-Path -LiteralPath $activePortFile) {
      $debugPort = [int](Get-Content -LiteralPath $activePortFile -TotalCount 1)
      if ($debugPort -gt 0) { break }
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $debugPort) { throw "The packaged Companion did not allocate an isolated browser-debug port." }
  $debugStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$debugPort/json/version" -TimeoutSec 5
  if (-not $debugStatus.webSocketDebuggerUrl) { throw "The packaged Companion browser-debug endpoint is unavailable." }

  $secondProcess = Start-Process -FilePath $executable -ArgumentList "--hidden" -WindowStyle Hidden -PassThru
  if (-not $secondProcess.WaitForExit(10000)) {
    Stop-Process -Id $secondProcess.Id -Force -ErrorAction SilentlyContinue
    throw "A second Companion process did not hand control back to the running instance."
  }
  $debugPortAfterSecondLaunch = [int](Get-Content -LiteralPath $activePortFile -TotalCount 1)
  if ($debugPortAfterSecondLaunch -ne $debugPort) {
    throw "A second Companion launch replaced the running instance's browser-debug endpoint."
  }
  $debugStatusAfterSecondLaunch = Invoke-RestMethod -Uri "http://127.0.0.1:$debugPort/json/version" -TimeoutSec 5
  if (-not $debugStatusAfterSecondLaunch.webSocketDebuggerUrl) {
    throw "The running Companion browser-debug endpoint was lost after a second launch."
  }

  $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8792/api/auth/login" -ContentType "application/json" -Body (@{
    username = $smokeUsername
    password = $smokePassword
  } | ConvertTo-Json) -TimeoutSec 5
  if (-not $login.token) { throw "The smoke-test operations manager could not sign in." }
  $authorization = @{ Authorization = "Bearer $($login.token)" }
  $instagramAccount = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8792/api/platforms/instagram/accounts" `
    -Headers $authorization -ContentType "application/json" -Body (@{
      displayName = "Instagram smoke account"
      handle = "@agenticthat-smoke"
      enabled = $true
    } | ConvertTo-Json) -TimeoutSec 5
  $manualLogin = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8792/api/accounts/$($instagramAccount.id)/manual-login" `
    -Headers $authorization -ContentType "application/json" -Body "{}" -TimeoutSec 5
  if (-not $manualLogin.started) { throw "The Instagram manual-login smoke session did not start." }
  $companionLog = Join-Path $smokeRoot "publishing-data\logs\publishing-companion.log"
  $loginNavigationReady = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    $loginLog = Get-Content -LiteralPath $companionLog -Raw
    if ($loginLog -match "Navigating to Instagram login page") {
      $loginNavigationReady = $true
      break
    }
  }
  if (-not $loginNavigationReady) {
    $logTail = (Get-Content -LiteralPath $companionLog -Tail 12) -join [Environment]::NewLine
    throw "The Instagram manual-login browser did not begin navigation.$([Environment]::NewLine)$logTail"
  }
  $loginLog = Get-Content -LiteralPath $companionLog -Raw
  if ($loginLog -match "ECONNREFUSED|Manual session preparation failed") {
    throw "The Instagram manual-login browser connection was refused."
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
  Write-Host "Embedded live browser: enabled"
  Write-Host "Isolated browser-debug port: $debugPort"
  Write-Host "Instagram manual-login browser: connected"
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
