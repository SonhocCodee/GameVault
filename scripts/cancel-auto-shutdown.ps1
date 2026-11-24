# Cancel auto shutdown and kill the monitor
shutdown.exe /a 2>$null
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*auto-shutdown-on-sync-done.ps1*" } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
    Write-Output "Stopped monitor process (PID: $($_.ProcessId))"
}
Write-Output "Auto-shutdown has been cancelled."
