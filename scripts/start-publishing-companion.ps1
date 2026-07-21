$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDirectory = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDirectory "publishing-companion.log"

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Set-Location $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  "Node.js is not installed or is not available in PATH." | Out-File -Append -FilePath $logPath
  exit 1
}

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
  & npm.cmd install 2>&1 | Tee-Object -Append -FilePath $logPath
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

& npm.cmd run publishing:companion 2>&1 | Tee-Object -Append -FilePath $logPath
exit $LASTEXITCODE
