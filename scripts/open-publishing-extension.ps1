$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot "extensions\publishing-companion"

if (-not (Test-Path -LiteralPath (Join-Path $extensionPath "manifest.json"))) {
  throw "Publishing extension files were not found at $extensionPath"
}

$chromeCandidates = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if ($chromeCandidates.Count -gt 0) {
  Start-Process -FilePath $chromeCandidates[0] -ArgumentList @("--new-window", "chrome://extensions/")
} else {
  Start-Process "chrome://extensions/"
}
Start-Process explorer.exe -ArgumentList @($extensionPath)

Write-Host ""
Write-Host "Chrome and the extension folder are open." -ForegroundColor Green
Write-Host "1. Turn on Developer mode in the top-right corner of chrome://extensions."
Write-Host "2. Click Load unpacked."
Write-Host "3. Choose this folder: $extensionPath"
Write-Host "4. Pin AgenticThat Publishing Companion from Chrome's Extensions menu."
Write-Host ""
Read-Host "Press Enter to close this helper"
