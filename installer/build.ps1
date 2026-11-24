# Builds the Windows installer:  build\out\LeonidaIntelligence-Setup-<version>.exe
#
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#
# Needs Node.js 24+ and npm, Inno Setup 6 (winget install JRSoftware.InnoSetup), and the C#
# compiler that comes with Windows (.NET Framework 4.x). The bundled Node.js runtime is a copy of
# the node.exe that runs this script. MinGit is downloaded once into build\vendor and checked
# against a pinned SHA-256.
param(
  [string]$Version,
  [string]$NodeExe,
  [string]$Iscc,
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Git for Windows "MinGit" (GPL-2.0): lets the app download the map with git, as GTADB asks.
$MinGit = @{
  Version = '2.56.1'
  Url     = 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/MinGit-2.56.1-64-bit.zip'
  Sha256  = '4a92850b6e917da4fd010669b614b55dccf5b0ec333a534cc4be4700dfefdafd'
}

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Download($url, $file) {
  Write-Host "    downloading $url"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file
}

if (-not $Version) { $Version = (Get-Content package.json -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3 (got '$Version')" }
if (-not $NodeExe) { $NodeExe = (Get-Command node).Source }
$nodeVersion = (& $NodeExe --version).Trim().TrimStart('v')
if ([int]$nodeVersion.Split('.')[0] -lt 24) { throw "Node.js 24+ is required to bundle (found $nodeVersion at $NodeExe)" }
if (-not $Iscc) {
  $candidates = @(
    (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  $Iscc = $candidates | Select-Object -First 1
  if (-not $Iscc) { throw 'Inno Setup 6 not found. Install it with: winget install JRSoftware.InnoSetup' }
}
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc" }

$build = Join-Path $root 'build'
$vendor = Join-Path $build 'vendor'
$stage = Join-Path $build 'stage'
$out = Join-Path $build 'out'
New-Item -ItemType Directory -Force $vendor, $out | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
Write-Host "Leonida Intelligence $Version  |  Node.js $nodeVersion  |  MinGit $($MinGit.Version)"

if (-not $SkipWebBuild) {
  Step 'Building the web app'
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
}
if (-not (Test-Path dist\index.html)) { throw 'dist\index.html missing; run npm run build' }

Step 'Copying the app'
$app = Join-Path $stage 'app'
New-Item -ItemType Directory -Force $app, (Join-Path $app 'scripts') | Out-Null
foreach ($d in 'server', 'shared', 'seed', 'dist') { Copy-Item -Recurse $d (Join-Path $app $d) }
Copy-Item scripts\fetch-data.ts (Join-Path $app 'scripts')
foreach ($f in 'package.json', 'package-lock.json', 'LICENSE', 'ATTRIBUTION.md', 'README.md', '.env.example') { Copy-Item $f $app }

Step 'Installing production dependencies'
Push-Location $app
try {
  & npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
} finally { Pop-Location }

Step 'Adding the Node.js runtime'
$runtime = Join-Path $stage 'runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null
Copy-Item $NodeExe (Join-Path $runtime 'node.exe')
$nodeLicense = Join-Path $vendor "node-v$nodeVersion-LICENSE.txt"
if (-not (Test-Path $nodeLicense)) { Download "https://raw.githubusercontent.com/nodejs/node/v$nodeVersion/LICENSE" $nodeLicense }
Copy-Item $nodeLicense (Join-Path $runtime 'LICENSE.txt')

Step 'Adding MinGit'
$minGitZip = Join-Path $vendor "MinGit-$($MinGit.Version)-64-bit.zip"
if (-not (Test-Path $minGitZip)) { Download $MinGit.Url $minGitZip }
$hash = (Get-FileHash $minGitZip -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $MinGit.Sha256) { Remove-Item $minGitZip; throw "MinGit checksum mismatch ($hash); the download was removed, try again" }
Expand-Archive -Path $minGitZip -DestinationPath (Join-Path $stage 'git')

Step 'Compiling the tray app'
& $csc /nologo /target:winexe /optimize+ "/out:$stage\Leonida.exe" `
  /win32icon:installer\leonida.ico /win32manifest:installer\Leonida.manifest `
  "/resource:installer\leonida.ico,Leonida.ico" /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  installer\Leonida.cs
if ($LASTEXITCODE -ne 0) { throw 'tray app failed to compile' }
Copy-Item -Recurse installer\tools (Join-Path $stage 'tools')

Step 'Writing third-party notices'
@"
Leonida Intelligence $Version for Windows bundles the following third-party software.

Node.js $nodeVersion (runtime\node.exe)
  https://nodejs.org - MIT licence and the licences of its bundled components: runtime\LICENSE.txt

MinGit $($MinGit.Version), part of Git for Windows (git\)
  https://gitforwindows.org - GNU General Public License v2 and others: git\LICENSE.txt
  Source code: https://github.com/git-for-windows/git

npm packages used by the server (app\node_modules)
  Fastify and its plugins, fast-xml-parser and their dependencies. Each package's licence is in
  its folder under app\node_modules.

Map tiles and landmark data are not included in this installer. They are downloaded from GTADB
(https://map.gtadb.org, CC BY 4.0) on your PC. See app\ATTRIBUTION.md.
"@ | Set-Content -Encoding utf8 (Join-Path $stage 'THIRD-PARTY-NOTICES.txt')

Step 'Building the installer'
& $Iscc /Q "/DAppVersion=$Version" "/DStageDir=$stage" "/O$out" installer\leonida.iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }
$exe = Join-Path $out "LeonidaIntelligence-Setup-$Version.exe"
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
"$sha  LeonidaIntelligence-Setup-$Version.exe" | Set-Content -Encoding ascii "$exe.sha256"
Write-Host "`nBuilt $exe" -ForegroundColor Green
Write-Host ("Size: {0:N1} MB   SHA-256: {1}" -f ((Get-Item $exe).Length / 1MB), $sha)
