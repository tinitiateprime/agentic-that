$ErrorActionPreference = "Stop"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "AgenticThat Companion.lnk"
$legacyShortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "AgenticThat Publishing Companion.lnk"

if (Test-Path $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host "Removed startup shortcut: $shortcutPath"
} else {
  Write-Host "The AgenticThat Companion startup shortcut is not installed."
}

if (Test-Path $legacyShortcutPath) {
  Remove-Item -LiteralPath $legacyShortcutPath -Force
  Write-Host "Removed legacy startup shortcut: $legacyShortcutPath"
}
