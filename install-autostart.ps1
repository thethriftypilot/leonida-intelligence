# Registers a Windows scheduled task that starts Leonida Intelligence (hidden) when you log on.
# Remove it again with:  .\install-autostart.ps1 -Remove
param([switch]$Remove)
$name = 'Leonida Intelligence'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Autostart removed."
  exit 0
}
$script = Join-Path $PSScriptRoot 'start.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Personal GTA VI map companion (LAN web app)' -Force | Out-Null
Write-Host "Autostart installed: Leonida Intelligence will start when $env:USERNAME logs on."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName '$name'"
