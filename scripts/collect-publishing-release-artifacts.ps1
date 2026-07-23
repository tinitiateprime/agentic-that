$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$desktopRoot = Join-Path $projectRoot "apps\publishing-companion-desktop"
$artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "artifacts"))
$makeRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot "out\make"))

if (-not $artifactRoot.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Artifact directory must stay inside the project workspace."
}

$manifest = Get-Content (Join-Path $desktopRoot "package.json") -Raw | ConvertFrom-Json
$setup = Get-ChildItem -LiteralPath $makeRoot -Recurse -File -Filter "AgenticThat-Publishing-Companion-Setup.exe" | Select-Object -First 1
$portable = Get-ChildItem -LiteralPath $makeRoot -Recurse -File -Filter ("*-{0}.zip" -f $manifest.version) | Select-Object -First 1
if (-not $setup) { throw "Windows companion Setup executable was not produced." }
if (-not $portable) { throw "Windows companion portable ZIP was not produced." }

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
Copy-Item -LiteralPath $setup.FullName -Destination (Join-Path $artifactRoot "AgenticThat-Publishing-Companion-Setup.exe") -Force
Copy-Item -LiteralPath $portable.FullName -Destination (Join-Path $artifactRoot ("AgenticThat-Publishing-Companion-{0}-Portable.zip" -f $manifest.version)) -Force

Write-Host "Windows companion release artifacts copied to $artifactRoot" -ForegroundColor Green
