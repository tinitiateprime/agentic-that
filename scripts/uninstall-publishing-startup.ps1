$ErrorActionPreference = "Stop"
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "AgenticThat Publishing Companion.lnk"

if (Test-Path $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host "Removed startup shortcut: $shortcutPath"
} else {
  Write-Host "The AgenticThat publishing startup shortcut is not installed."
}
