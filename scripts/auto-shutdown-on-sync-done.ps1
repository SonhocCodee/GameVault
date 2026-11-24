# Auto-shutdown monitor for GameVault Drive sync
param(
    [int]$IdleThresholdSeconds = 60,
    [double]$SpeedThresholdKB = 500,
    [string]$LogFile = "$PSScriptRoot\auto-shutdown.log"
)

function Write-Log($msg) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$timestamp] $msg"
    Write-Output $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

Write-Log "=== AUTO-SHUTDOWN MONITOR STARTED ==="
Write-Log "Monitoring GameVault Google Drive sync upload..."

$consecutiveIdleSeconds = 0
$checkInterval = 10
$adapterName = "Realtek PCIe GbE Family Controller"

while ($true) {
    Start-Sleep -Seconds $checkInterval

    # 1. Check if Electron processes are still running
    $electronProcs = Get-Process -Name "electron" -ErrorAction SilentlyContinue
    if (-not $electronProcs) {
        Write-Log "Electron is no longer running. Waiting 15s to verify..."
        Start-Sleep -Seconds 15
        $electronProcs = Get-Process -Name "electron" -ErrorAction SilentlyContinue
        if (-not $electronProcs) {
            Write-Log "Electron closed completely. Proceeding to shutdown..."
            break
        }
    }

    # 2. Measure network upload rate
    $currentSpeedKB = 0
    try {
        $samples = (Get-Counter "\Network Interface($adapterName)\Bytes Sent/sec" -SampleInterval 1 -MaxSamples 2 -ErrorAction Stop).CounterSamples
        $currentSpeedKB = [math]::Round(($samples[-1].CookedValue) / 1KB, 1)
    } catch {
        # Fallback to wildcard if adapter name differs
        try {
            $samples = (Get-Counter "\Network Interface(*)\Bytes Sent/sec" -SampleInterval 1 -MaxSamples 2 -ErrorAction Stop).CounterSamples | Where-Object { $_.Path -notlike "*teredo*" -and $_.Path -notlike "*loopback*" }
            $maxVal = ($samples | Measure-Object -Property CookedValue -Maximum).Maximum
            $currentSpeedKB = [math]::Round($maxVal / 1KB, 1)
        } catch {
            $currentSpeedKB = 0
        }
    }

    $currentSpeedMB = [math]::Round($currentSpeedKB / 1024, 2)

    # 3. Check active connections on port 443
    $activeConns = 0
    try {
        $pids = $electronProcs | Select-Object -ExpandProperty Id
        $conns = Get-NetTCPConnection -OwningProcess $pids -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 443 }
        $activeConns = ($conns | Measure-Object).Count
    } catch {
        $activeConns = 0
    }

    if ($currentSpeedKB -lt $SpeedThresholdKB) {
        $consecutiveIdleSeconds += $checkInterval
        Write-Log "Upload low ($currentSpeedMB MB/s, $activeConns conns). Idle duration: $consecutiveIdleSeconds / $IdleThresholdSeconds s"
        if ($consecutiveIdleSeconds -ge $IdleThresholdSeconds) {
            Write-Log "Sync confirmed COMPLETE (Idle for $consecutiveIdleSeconds seconds with low traffic)."
            break
        }
    } else {
        if ($consecutiveIdleSeconds -gt 0) {
            Write-Log "Upload resumed: $currentSpeedMB MB/s ($activeConns conns). Resetting idle timer."
        }
        $consecutiveIdleSeconds = 0
        Write-Log "Uploading actively: $currentSpeedMB MB/s (active connections: $activeConns)"
    }
}

Write-Log "Triggering system shutdown in 60 seconds..."
shutdown.exe /s /t 60 /c "GameVault da dong bo xong toan bo anh & video len Google Drive! May tinh se tat sau 60 giay. Nhan Win+R go 'shutdown -a' neu muon huy."
Write-Log "Shutdown command executed."
