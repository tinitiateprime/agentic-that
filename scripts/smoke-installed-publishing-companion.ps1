$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$desktopRoot = Join-Path $projectRoot "apps\publishing-companion-desktop"
$expectedVersion = (Get-Content -LiteralPath (Join-Path $desktopRoot "package.json") -Raw | ConvertFrom-Json).version
$setup = Join-Path $desktopRoot "out\make\squirrel.windows\x64\AgenticThat-Publishing-Companion-Setup.exe"
$installRoot = Join-Path $env:LOCALAPPDATA "agenticthat_publishing_companion"
$installedAppRoot = Join-Path $installRoot "app-$expectedVersion"

if (-not (Test-Path -LiteralPath $setup)) {
  throw "Build the Windows Companion installer before running this smoke test."
}

$previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
$previousPackageRoot = $env:AGENTICTHAT_COMPANION_PACKAGE_ROOT
try {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $installer = Start-Process -FilePath $setup -ArgumentList "--silent" -WindowStyle Hidden -PassThru -Wait
  if ($installer.ExitCode -ne 0) {
    throw "The Windows Companion installer exited with code $($installer.ExitCode)."
  }

  $requiredFiles = @(
    "AgenticThat Publishing Companion.exe",
    "snapshot_blob.bin",
    "v8_context_snapshot.bin",
    "resources.pak",
    "resources\app\main.js",
    "resources\app\runtime\server.mjs"
  )
  foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $installedAppRoot $relativePath))) {
      throw "The installed Companion is missing $relativePath."
    }
  }

  $shortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\AgenticThat\AgenticThat Companion.lnk"
  if (-not (Test-Path -LiteralPath $shortcutPath)) {
    throw "The Windows installer did not create the AgenticThat Companion Start Menu shortcut."
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $expectedLauncher = Join-Path $installRoot "AgenticThat Publishing Companion.exe"
  if ([System.IO.Path]::GetFullPath($shortcut.TargetPath) -ne [System.IO.Path]::GetFullPath($expectedLauncher)) {
    throw "The installed Companion shortcut does not target the Squirrel launcher."
  }

  $env:AGENTICTHAT_COMPANION_PACKAGE_ROOT = $installedAppRoot
  & (Join-Path $PSScriptRoot "smoke-publishing-companion.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "The installed Windows Companion smoke test failed with code $LASTEXITCODE."
  }

  Write-Host "Installed Windows Companion $expectedVersion smoke test passed." -ForegroundColor Green
} finally {
  if ($null -eq $previousElectronRunAsNode) {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  } else {
    $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
  }
  if ($null -eq $previousPackageRoot) {
    Remove-Item Env:AGENTICTHAT_COMPANION_PACKAGE_ROOT -ErrorAction SilentlyContinue
  } else {
    $env:AGENTICTHAT_COMPANION_PACKAGE_ROOT = $previousPackageRoot
  }
}
