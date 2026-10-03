$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$desktopRoot = Join-Path $projectRoot "apps\publishing-companion-desktop"
$outRoot = Join-Path $desktopRoot "out"

$setup = Get-ChildItem -LiteralPath (Join-Path $outRoot "make") -Recurse -File -Filter "AgenticThat-Publishing-Companion-Setup.exe" | Select-Object -First 1
$app = Get-ChildItem -LiteralPath $outRoot -Recurse -File -Filter "AgenticThat Publishing Companion.exe" |
  Where-Object { $_.FullName -notlike "*\make\*" } |
  Select-Object -First 1

if (-not $setup) { throw "The signed Windows Setup executable was not found." }
if (-not $app) { throw "The signed Portable Companion executable was not found." }

$targets = @($app, $setup)
$publisherSubject = $null

foreach ($target in $targets) {
  $signature = Get-AuthenticodeSignature -LiteralPath $target.FullName
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "$($target.Name) does not have a valid trusted Authenticode signature. Status: $($signature.Status)."
  }
  if (-not $signature.SignerCertificate) {
    throw "$($target.Name) does not contain a signer certificate."
  }
  if ($signature.SignerCertificate.PublicKey.Oid.Value -ne "1.2.840.113549.1.1.1") {
    throw "$($target.Name) must use an RSA code-signing certificate for Smart App Control compatibility."
  }
  if (-not $signature.TimeStamperCertificate) {
    throw "$($target.Name) does not contain a trusted timestamp."
  }
  if (-not $publisherSubject) {
    $publisherSubject = $signature.SignerCertificate.Subject
  } elseif ($signature.SignerCertificate.Subject -ne $publisherSubject) {
    throw "The Portable Companion and Setup executable were signed by different publishers."
  }
  Write-Host "Verified signed artifact: $($target.FullName)" -ForegroundColor Green
}

Write-Host "Windows publisher verified: $publisherSubject" -ForegroundColor Green
