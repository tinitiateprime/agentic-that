$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runnerPath = Join-Path $PSScriptRoot "start-publishing-companion.ps1"
$startupDirectory = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDirectory "AgenticThat Publishing Companion.lnk"
$powerShellPath = (Get-Command powershell.exe).Source

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Starts the AgenticThat local scheduler and browser publisher"
$shortcut.Save()

Write-Host "Installed startup shortcut: $shortcutPath"
Write-Host "The publishing companion will start automatically the next time you sign in to Windows."
