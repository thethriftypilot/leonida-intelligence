# Starts Leonida Intelligence and restarts it automatically if it ever crashes.
# Stop with Ctrl+C (twice to also stop the restart loop).
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
if (-not (Test-Path dist\index.html)) { Write-Host "Web app not built yet - running setup steps first..."; & npm run build }
while ($true) {
  & node --disable-warning=ExperimentalWarning server/main.ts
  $code = $LASTEXITCODE
  if ($code -eq 0) { break }
  Write-Host "Leonida Intelligence exited with code $code - restarting in 5 seconds (Ctrl+C to cancel)..." -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
