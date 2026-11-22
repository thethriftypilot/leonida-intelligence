# Leonida Intelligence — Windows setup
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
param(
  [switch]$HiRes,          # also download the highest-zoom map level (bigger download)
  [switch]$SkipMapDownload
)
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Fail($msg) { Write-Host "`n[X] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }

Write-Host "`n=== Leonida Intelligence setup ===`n" -ForegroundColor Magenta

# 1. Node.js 24+
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 24 or newer is required. Install it with:  winget install OpenJS.NodeJS  (then reopen PowerShell)" }
$ver = (& node --version).TrimStart('v')
if ([int]($ver.Split('.')[0]) -lt 24) { Fail "Node.js $ver found; version 24 or newer is required (winget upgrade OpenJS.NodeJS)." }
Ok "Node.js $ver"

# 2. git (used to download the map the way GTADB asks: git pull)
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git is required. Install it with:  winget install Git.Git  (then reopen PowerShell)" }
Ok "git found"

# 3. Dependencies and build
Write-Host "Installing dependencies..."
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
Write-Host "Building the web app..."
& npm run build
if ($LASTEXITCODE -ne 0) { Fail "build failed" }
Ok "Web app built"

# 4. Configuration
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Ok "Created .env (edit it to change port, PIN, schedule)" }

# 5. Map data
if (-not $SkipMapDownload) {
  Write-Host "Downloading map tiles and landmark data from GTADB (first time ~100 MB)..."
  $fetchArgs = @('--disable-warning=ExperimentalWarning', 'scripts/fetch-data.ts')
  if ($HiRes) { $fetchArgs += '--hires' }
  & node @fetchArgs
  if ($LASTEXITCODE -ne 0) { Fail "map download failed — see docs/troubleshooting.md" }
  Ok "Map data ready"
}

# 6. Firewall (optional, needs admin) — allows other devices on your PRIVATE network only
$port = 5180
if (Test-Path .env) { $m = Select-String -Path .env -Pattern '^\s*LI_PORT\s*=\s*(\d+)' | Select-Object -First 1; if ($m) { $port = [int]$m.Matches[0].Groups[1].Value } }
$answer = Read-Host "Allow other computers on your home (Private) network to connect on port $port? This opens an admin prompt. [Y/n]"
if ($answer -eq '' -or $answer -match '^[Yy]') {
  $cmd = "New-NetFirewallRule -DisplayName 'Leonida Intelligence (LAN)' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private -ErrorAction SilentlyContinue | Out-Null"
  try { Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -Command $cmd" -Wait; Ok "Firewall rule added for Private networks" }
  catch { Write-Host "Firewall rule skipped ($($_.Exception.Message)). See README > Network access." -ForegroundColor Yellow }
}

Write-Host "`nSetup complete. Start the app with:  .\start.cmd   (or: npm start)" -ForegroundColor Cyan
Write-Host "Then open http://localhost:$port on this PC, or http://<this-PC's-IP>:$port on other devices." -ForegroundColor Cyan
