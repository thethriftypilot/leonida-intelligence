# Network helpers for the Windows version of Leonida Intelligence. Run with administrator rights
# by the installer, the uninstaller and the tray app's "Open on my phone or tablet" window.
#
#   network.ps1 -AddFirewall -Program <path to node.exe>   allow on Private networks, block on Public
#   network.ps1 -RemoveFirewall                            remove the rules again
#   network.ps1 -MakePrivate <interface index>             mark a network as Private (home) network
param(
  [switch]$AddFirewall,
  [switch]$RemoveFirewall,
  [string]$Program,
  [int]$MakePrivate = 0
)
$ErrorActionPreference = 'Stop'
$group = 'Leonida Intelligence'
try {
  if ($AddFirewall -or $RemoveFirewall) {
    Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
  if ($AddFirewall) {
    if (-not $Program -or -not (Test-Path -LiteralPath $Program)) { throw "Program not found: $Program" }
    New-NetFirewallRule -DisplayName 'Leonida Intelligence' -Group $group `
      -Description 'Lets devices on your home (Private) network open the Leonida Intelligence map.' `
      -Direction Inbound -Program $Program -Protocol TCP -Action Allow -Profile Private | Out-Null
    # An explicit rule for Public networks stops Windows from asking, and keeps the app closed
    # on networks such as cafe or hotel Wi-Fi.
    New-NetFirewallRule -DisplayName 'Leonida Intelligence (blocked on public networks)' -Group $group `
      -Description 'Keeps Leonida Intelligence closed to other devices on Public networks.' `
      -Direction Inbound -Program $Program -Action Block -Profile Public | Out-Null
  }
  if ($MakePrivate -gt 0) {
    Set-NetConnectionProfile -InterfaceIndex $MakePrivate -NetworkCategory Private
  }
  exit 0
} catch {
  Write-Error $_
  exit 1
}
